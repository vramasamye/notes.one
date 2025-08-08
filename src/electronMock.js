const path = require('path');
const fs = require('fs');

const testDataPath = path.join(__dirname, 'test_data');

if (!fs.existsSync(testDataPath)) {
  fs.mkdirSync(testDataPath);
}

module.exports = {
  app: {
    getPath: jest.fn(() => testDataPath),
  },
};
