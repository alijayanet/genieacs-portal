const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '../settings.json');

function getSettings() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function setAdminEnabled(status) {
  const settings = getSettings();
  settings.admin_enabled = status;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function isAdmin(number) {
  const settings = getSettings();
  return settings.admin_enabled && settings.admins.includes(number);
}

function getAdmins() {
  const settings = getSettings();
  return settings.admins;
}

module.exports = {
  getSettings,
  setAdminEnabled,
  isAdmin,
  getAdmins
};
