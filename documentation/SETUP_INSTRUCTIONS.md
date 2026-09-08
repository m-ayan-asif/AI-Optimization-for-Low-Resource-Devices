# SkinSense Patient Portal — Setup Instructions

## Prerequisites
- Node.js v18+ installed
- PostgreSQL installed and running
- Git configured with your GitHub account
- VS Code with Claude Code extension

## Step-by-Step Terminal Commands

### 1. Clone and Initialize

```bash
# Open VS Code terminal (Ctrl + `)
cd ~/Desktop  # or wherever you want the project
git clone https://github.com/ibrahimbiabani/FYP-SkinSense-UI.git
cd FYP-SkinSense-UI
```

### 2. Create Project Structure

```bash
# Create all directories
mkdir -p client/src/{components/{layout,screening,auth,common,history,clinics},pages,hooks,context,utils,i18n,assets}
mkdir -p server/{src/{routes,controllers,middleware,models,config,utils},migrations}
mkdir -p shared
```

### 3. Initialize and Install — Server

```bash
cd server
npm init -y
npm install express cors pg bcryptjs jsonwebtoken multer dotenv express-validator cookie-parser
npm install -D nodemon
cd ..
```

### 4. Initialize and Install — Client

```bash
cd client
npm create vite@latest . -- --template react
# When prompted: select "React" and "JavaScript"
npm install
npm install react-router-dom axios react-i18next i18next i18next-browser-languagedetector lucide-react
npm install -D tailwindcss @tailwindcss/vite
cd ..
```

### 5. Copy All Scaffolding Files

Copy every file from the scaffolding package into the matching paths in your project.

### 6. Set Up PostgreSQL

```bash
# In terminal — adjust username if needed
psql -U postgres -c "CREATE DATABASE skinsense;"
psql -U postgres -d skinsense -f server/migrations/001_initial_schema.sql
```

### 7. Configure Environment

```bash
cp server/.env.example server/.env
# Edit server/.env with your actual PostgreSQL credentials
```

### 8. Run the Project

```bash
# Terminal 1 — Server
cd server
npm run dev

# Terminal 2 — Client
cd client
npm run dev
```

### 9. Push to GitHub

```bash
git add .
git commit -m "feat: initial project scaffolding with patient portal structure"
git push origin main
```

## Project Structure After Setup

```
FYP-SkinSense-UI/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/        → Header, Footer, LanguageToggle
│   │   │   ├── screening/     → ImageUpload, VoiceInput, ResultsDisplay, HeatmapOverlay
│   │   │   ├── auth/          → LoginForm, RegisterForm, RoleSelector
│   │   │   ├── common/        → Button, Card, LoadingSpinner, Disclaimer
│   │   │   ├── history/       → HistoryList, HistoryCard
│   │   │   └── clinics/       → ClinicFinder, ClinicCard
│   │   ├── pages/             → LoginPage, RegisterPage, DashboardPage, ScreeningPage, ResultsPage, HistoryPage, ClinicsPage
│   │   ├── hooks/             → useAuth, useScreening, useVoiceRecorder
│   │   ├── context/           → AuthContext, LanguageContext
│   │   ├── utils/             → api.js, imageValidation.js, constants.js
│   │   ├── i18n/              → en.json, ur.json, i18n.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
├── server/
│   ├── src/
│   │   ├── routes/            → auth.js, screening.js, clinics.js
│   │   ├── controllers/       → authController.js, screeningController.js, clinicController.js
│   │   ├── middleware/        → auth.js, upload.js, validate.js
│   │   ├── models/            → db.js, User.js, Screening.js
│   │   ├── config/            → index.js
│   │   └── utils/             → mockData.js
│   ├── migrations/            → 001_initial_schema.sql
│   ├── server.js
│   ├── .env.example
│   └── package.json
├── .gitignore
└── README.md
```
