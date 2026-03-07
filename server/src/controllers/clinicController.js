const { MOCK_CLINICS } = require('../utils/mockData');

async function getNearby(req, res) {
  const { region, city } = req.query;

  let filtered = MOCK_CLINICS;

  if (region) {
    filtered = filtered.filter(
      (c) => c.region.toLowerCase() === region.toLowerCase()
    );
  }
  if (city) {
    filtered = filtered.filter(
      (c) => c.city.toLowerCase() === city.toLowerCase()
    );
  }

  // If no filters or no matches, return all
  if (filtered.length === 0) {
    filtered = MOCK_CLINICS;
  }

  res.json(filtered);
}

module.exports = { getNearby };
