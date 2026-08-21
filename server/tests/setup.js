const os = require('os');
const path = require('path');
const fs = require('fs');

// Set env vars before any module is loaded by Jest
process.env.JWT_SECRET = 'test_jwt_secret_do_not_use_in_prod';
process.env.JWT_EXPIRES_IN = '1h';
process.env.INFERENCE_URL = 'http://localhost:5001';

// Use a real temp dir so multer has somewhere to write during upload tests
const testUploadDir = path.join(os.tmpdir(), 'skinsense-test-uploads');
if (!fs.existsSync(testUploadDir)) {
  fs.mkdirSync(testUploadDir, { recursive: true });
}
process.env.UPLOAD_DIR = testUploadDir;
