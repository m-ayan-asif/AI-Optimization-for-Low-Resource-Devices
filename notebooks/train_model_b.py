"""
Model B Training Harness — Surprise-Only Propagation vs Baseline Control

This script trains both Model B and Baseline on SkinSense dataset,
compares accuracy/convergence/efficiency, and logs everything for analysis.

Usage:
  python train_model_b.py \
    --data_dir ../data/processed \
    --output_dir ../models/model_b \
    --epochs 50 \
    --batch_size 32
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.optim import Adam
from torch.utils.data import Dataset, DataLoader
import torch.utils.data as data_utils
from torchvision import transforms
from torch.utils.tensorboard import SummaryWriter

import pandas as pd
import numpy as np
from PIL import Image
import os
import json
import argparse
from pathlib import Path
from datetime import datetime
import matplotlib.pyplot as plt

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Device: {device}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")


# ──────────────────────────────────────────────────────────────────
# DATA LOADING (same as your notebook)
# ──────────────────────────────────────────────────────────────────

class SkinDataset(Dataset):
    """Load images from CSV with image_path and numeric_label columns."""
    def __init__(self, csv_path, transform=None):
        self.df = pd.read_csv(csv_path)
        self.transform = transform
        
    def __len__(self):
        return len(self.df)
    
    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        image_path = row['image_path']
        label = row['numeric_label']
        
        try:
            image = Image.open(image_path).convert('RGB')
        except Exception as e:
            # Fallback to blank image if load fails
            image = Image.new('RGB', (224, 224))
            
        if self.transform:
            image = self.transform(image)
            
        return image, label


def get_dataloaders(data_dir, batch_size=32, num_workers=4):
    """Create train/val/test dataloaders matching your setup."""
    
    IMG_SIZE = 224
    
    train_transform = transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(),
        transforms.RandomRotation(15),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1),
        transforms.RandomAffine(degrees=0, translate=(0.1, 0.1)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], 
                            std=[0.229, 0.224, 0.225])
    ])
    
    val_transform = transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], 
                            std=[0.229, 0.224, 0.225])
    ])
    
    train_dataset = SkinDataset(f'{data_dir}/train.csv', transform=train_transform)
    val_dataset = SkinDataset(f'{data_dir}/val.csv', transform=val_transform)
    test_dataset = SkinDataset(f'{data_dir}/test.csv', transform=val_transform)
    
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True
    )
    
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=True
    )
    
    test_loader = DataLoader(
        test_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=True
    )
    
    return train_loader, val_loader, test_loader


# ──────────────────────────────────────────────────────────────────
# MODEL ARCHITECTURE
# ──────────────────────────────────────────────────────────────────

class PredictiveLayer(nn.Module):
    """Encodes, predicts, and gates surprise signal."""
    def __init__(self, in_channels, out_channels, stride=1):
        super().__init__()
        
        self.encoder = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, stride=stride, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True)
        )
        
        self.predictor = nn.Sequential(
            nn.Conv2d(out_channels, in_channels, 1, bias=False),
            nn.BatchNorm2d(in_channels)
        )
        
        self.error_encoder = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, stride=stride, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True)
        )
        
        self.surprise_gate = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(out_channels, out_channels),
            nn.Sigmoid()
        )
        
    def forward(self, x):
        encoded = self.encoder(x)
        prediction = self.predictor(encoded)
        
        if prediction.shape != x.shape:
            prediction = F.interpolate(prediction, size=x.shape[2:], mode='bilinear', align_corners=False)
        
        error = x - prediction
        error_encoded = self.error_encoder(error)
        
        gate = self.surprise_gate(error_encoded)
        gate = gate.unsqueeze(-1).unsqueeze(-1)
        gated_error = error_encoded * gate
        
        return gated_error, prediction, error, gate.squeeze(-1).squeeze(-1)


class ModelB(nn.Module):
    """Full Model B: surprise-only propagation."""
    def __init__(self, num_classes=7):
        super().__init__()
        
        self.layer1 = PredictiveLayer(3, 32, stride=1)
        self.layer2 = PredictiveLayer(32, 64, stride=2)
        self.layer3 = PredictiveLayer(64, 128, stride=2)
        self.layer4 = PredictiveLayer(128, 256, stride=2)
        
        self.global_pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(256, num_classes)
        
    def forward(self, x):
        error1, pred1, raw_err1, gate1 = self.layer1(x)
        error2, pred2, raw_err2, gate2 = self.layer2(error1)
        error3, pred3, raw_err3, gate3 = self.layer3(error2)
        error4, pred4, raw_err4, gate4 = self.layer4(error3)
        
        pooled = self.global_pool(error4)
        logits = self.fc(pooled.view(pooled.size(0), -1))
        
        aux = {
            'predictions': [pred1, pred2, pred3, pred4],
            'errors': [raw_err1, raw_err2, raw_err3, raw_err4],
            'gates': [gate1, gate2, gate3, gate4],
            'inputs': [x, error1, error2, error3]
        }
        
        return logits, aux


class StandardConvLayer(nn.Module):
    """Standard conv block for baseline."""
    def __init__(self, in_channels, out_channels, stride=1):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, stride=stride, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True)
        )
    
    def forward(self, x):
        return self.conv(x)


class Baseline(nn.Module):
    """Baseline: standard convolutions, full activations."""
    def __init__(self, num_classes=7):
        super().__init__()
        
        self.layer1 = StandardConvLayer(3, 32, stride=1)
        self.layer2 = StandardConvLayer(32, 64, stride=2)
        self.layer3 = StandardConvLayer(64, 128, stride=2)
        self.layer4 = StandardConvLayer(128, 256, stride=2)
        
        self.global_pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(256, 7)
        
    def forward(self, x):
        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)
        
        pooled = self.global_pool(x)
        logits = self.fc(pooled.view(pooled.size(0), -1))
        
        return logits, {}


# ──────────────────────────────────────────────────────────────────
# LOSS FUNCTIONS
# ──────────────────────────────────────────────────────────────────

def model_b_loss(logits, targets, aux, 
                 w_class=1.0, w_recon=0.1, w_sparse=0.01):
    """Multi-component loss for Model B."""
    
    class_loss = F.cross_entropy(logits, targets)
    
    # Reconstruction loss
    recon_loss = 0
    for pred, target_input in zip(aux['predictions'], aux['inputs']):
        if pred.shape != target_input.shape:
            pred = F.interpolate(pred, size=target_input.shape[2:], mode='bilinear', align_corners=False)
        recon_loss += F.mse_loss(pred, target_input)
    recon_loss /= len(aux['predictions'])
    
    # Sparsity loss
    sparse_loss = 0
    for gate in aux['gates']:
        sparse_loss += gate.mean()
    sparse_loss /= len(aux['gates'])
    
    total_loss = (w_class * class_loss + 
                  w_recon * recon_loss + 
                  w_sparse * sparse_loss)
    
    return {
        'total': total_loss,
        'classification': class_loss.item(),
        'reconstruction': recon_loss.item(),
        'sparsity': sparse_loss.item()
    }


def baseline_loss(logits, targets):
    """Simple cross-entropy for baseline."""
    ce = F.cross_entropy(logits, targets)
    return {'total': ce, 'classification': ce.item()}


# ──────────────────────────────────────────────────────────────────
# TRAINING & EVALUATION
# ──────────────────────────────────────────────────────────────────

def train_epoch(model, train_loader, optimizer, model_type='b'):
    """Train one epoch."""
    model.train()
    total_loss = 0
    correct = 0
    total = 0
    gate_activations = []
    
    for batch_idx, (images, labels) in enumerate(train_loader):
        images, labels = images.to(device), labels.to(device)
        
        optimizer.zero_grad()
        
        if model_type == 'b':
            logits, aux = model(images)
            loss_dict = model_b_loss(logits, labels, aux)
            loss = loss_dict['total']
            gate_activations.extend([g.mean().item() for g in aux['gates']])
        else:
            logits, _ = model(images)
            loss_dict = baseline_loss(logits, labels)
            loss = loss_dict['total']
        
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        
        total_loss += loss_dict['total'].item() if isinstance(loss_dict['total'], torch.Tensor) else loss_dict['total']
        _, predicted = logits.max(1)
        correct += predicted.eq(labels).sum().item()
        total += labels.size(0)
    
    avg_loss = total_loss / len(train_loader)
    avg_acc = correct / total
    avg_gate = np.mean(gate_activations) if gate_activations else 0
    
    return avg_loss, avg_acc, avg_gate


def eval_epoch(model, eval_loader, model_type='b'):
    """Evaluate one epoch."""
    model.eval()
    total_loss = 0
    correct = 0
    total = 0
    gate_activations = []
    
    with torch.no_grad():
        for images, labels in eval_loader:
            images, labels = images.to(device), labels.to(device)
            
            if model_type == 'b':
                logits, aux = model(images)
                loss_dict = model_b_loss(logits, labels, aux)
                gate_activations.extend([g.mean().item() for g in aux['gates']])
            else:
                logits, _ = model(images)
                loss_dict = baseline_loss(logits, labels)
            
            total_loss += loss_dict['total'].item() if isinstance(loss_dict['total'], torch.Tensor) else loss_dict['total']
            _, predicted = logits.max(1)
            correct += predicted.eq(labels).sum().item()
            total += labels.size(0)
    
    avg_loss = total_loss / len(eval_loader)
    avg_acc = correct / total
    avg_gate = np.mean(gate_activations) if gate_activations else 0
    
    return avg_loss, avg_acc, avg_gate


def train_model(model, train_loader, val_loader, test_loader, epochs, 
                model_type='b', output_dir='./checkpoints', lr=1e-3):
    """Main training loop."""
    
    os.makedirs(output_dir, exist_ok=True)
    model = model.to(device)
    
    optimizer = Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    
    history = {
        'train_loss': [], 'train_acc': [], 'train_gate': [],
        'val_loss': [], 'val_acc': [], 'val_gate': [],
        'test_loss': [], 'test_acc': [], 'test_gate': []
    }
    
    best_val_acc = 0
    best_epoch = 0
    
    print(f"\n{'='*80}")
    print(f"Training {model_type.upper()} for {epochs} epochs")
    print(f"{'='*80}\n")
    
    for epoch in range(epochs):
        # Train
        train_loss, train_acc, train_gate = train_epoch(model, train_loader, optimizer, model_type)
        
        # Validate
        val_loss, val_acc, val_gate = eval_epoch(model, val_loader, model_type)
        
        # Test
        test_loss, test_acc, test_gate = eval_epoch(model, test_loader, model_type)
        
        scheduler.step()
        
        # Record
        history['train_loss'].append(train_loss)
        history['train_acc'].append(train_acc)
        history['train_gate'].append(train_gate)
        history['val_loss'].append(val_loss)
        history['val_acc'].append(val_acc)
        history['val_gate'].append(val_gate)
        history['test_loss'].append(test_loss)
        history['test_acc'].append(test_acc)
        history['test_gate'].append(test_gate)
        
        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_epoch = epoch
            torch.save(model.state_dict(), f'{output_dir}/best_model.pth')
        
        # Log
        if (epoch + 1) % 5 == 0 or epoch == 0:
            gate_str = f"  gate_train: {train_gate:.4f}  gate_val: {val_gate:.4f}" if model_type == 'b' else ""
            print(f"Epoch {epoch+1:3d}/{epochs}  |  "
                  f"Train: {train_acc:.4f} acc  {train_loss:.4f} loss  |  "
                  f"Val: {val_acc:.4f} acc  {val_loss:.4f} loss  |  "
                  f"Test: {test_acc:.4f} acc{gate_str}")
    
    print(f"\nBest validation accuracy: {best_val_acc:.4f} at epoch {best_epoch+1}")
    
    # Save history
    with open(f'{output_dir}/history.json', 'w') as f:
        json.dump(history, f, indent=2)
    
    return model, history


# ──────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Train Model B and Baseline')
    parser.add_argument('--data_dir', type=str, default='../data/processed',
                        help='Path to processed data directory')
    parser.add_argument('--output_dir', type=str, default='../models/model_b',
                        help='Path to save models and results')
    parser.add_argument('--epochs', type=int, default=50,
                        help='Number of epochs to train')
    parser.add_argument('--batch_size', type=int, default=32,
                        help='Batch size for training')
    parser.add_argument('--lr', type=float, default=1e-3,
                        help='Learning rate')
    parser.add_argument('--model_type', type=str, default='both',
                        choices=['b', 'baseline', 'both'],
                        help='Which model to train')
    
    args = parser.parse_args()
    
    # Create dataloaders
    print(f"\nLoading data from {args.data_dir}")
    train_loader, val_loader, test_loader = get_dataloaders(
        args.data_dir, 
        batch_size=args.batch_size
    )
    print(f"Train batches: {len(train_loader)}")
    print(f"Val batches: {len(val_loader)}")
    print(f"Test batches: {len(test_loader)}")
    
    # Train Model B
    if args.model_type in ['b', 'both']:
        model_b = ModelB(num_classes=7)
        output_dir_b = f"{args.output_dir}/model_b_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        model_b, history_b = train_model(
            model_b, train_loader, val_loader, test_loader, 
            epochs=args.epochs, 
            model_type='b',
            output_dir=output_dir_b,
            lr=args.lr
        )
        print(f"\nModel B checkpoints saved to: {output_dir_b}")
    
    # Train Baseline
    if args.model_type in ['baseline', 'both']:
        baseline = Baseline(num_classes=7)
        output_dir_baseline = f"{args.output_dir}/baseline_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        baseline_model, history_baseline = train_model(
            baseline, train_loader, val_loader, test_loader,
            epochs=args.epochs,
            model_type='baseline',
            output_dir=output_dir_baseline,
            lr=args.lr
        )
        print(f"\nBaseline checkpoints saved to: {output_dir_baseline}")
    
    # Comparison
    if args.model_type == 'both':
        print(f"\n{'='*80}")
        print("COMPARISON: Model B vs Baseline")
        print(f"{'='*80}\n")
        
        best_b_idx = np.argmax(history_b['val_acc'])
        best_baseline_idx = np.argmax(history_baseline['val_acc'])
        
        print(f"Model B:")
        print(f"  Best Val Acc: {history_b['val_acc'][best_b_idx]:.4f} (epoch {best_b_idx+1})")
        print(f"  Test Acc: {history_b['test_acc'][best_b_idx]:.4f}")
        print(f"  Epochs to 50% acc: {next((i for i, acc in enumerate(history_b['val_acc']) if acc >= 0.50), None)}")
        print(f"  Avg gate activation: {np.mean(history_b['val_gate']):.4f}")
        
        print(f"\nBaseline:")
        print(f"  Best Val Acc: {history_baseline['val_acc'][best_baseline_idx]:.4f} (epoch {best_baseline_idx+1})")
        print(f"  Test Acc: {history_baseline['test_acc'][best_baseline_idx]:.4f}")
        print(f"  Epochs to 50% acc: {next((i for i, acc in enumerate(history_baseline['val_acc']) if acc >= 0.50), None)}")


if __name__ == '__main__':
    main()
