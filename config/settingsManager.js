const fs = require('fs');
const path = require('path');

// Cache untuk settings dengan timestamp
let settingsCache = null;
let settingsCacheTime = 0;
const CACHE_DURATION = 2000; // 2 detik

// File system watcher untuk auto-reload settings
const settingsPath = path.join(__dirname, '../settings.json');
let watcher = null;

// Helper untuk baca settings.json secara dinamis
function getSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch (error) {
    console.error('❌ Error reading settings.json:', error.message);
    return {};
  }
}

// Helper untuk baca settings.json dengan cache
function getSettingsWithCache() {
  const now = Date.now();
  if (!settingsCache || (now - settingsCacheTime) > CACHE_DURATION) {
    settingsCache = getSettings();
    settingsCacheTime = now;
    console.log('🔄 Settings reloaded from file');
  }
  return settingsCache;
}

// Helper untuk mendapatkan nilai setting dengan fallback
function getSetting(key, defaultValue = null) {
  const settings = getSettingsWithCache();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

// Helper untuk mendapatkan multiple settings
function getSettingsByKeys(keys) {
  const settings = getSettingsWithCache();
  const result = {};
  keys.forEach(key => {
    result[key] = settings[key];
  });
  return result;
}

// File system watcher untuk auto-reload settings
function startSettingsWatcher() {
  try {
    // Hapus watcher lama jika ada
    if (watcher) {
      watcher.close();
    }
    
    // Buat watcher baru
    watcher = fs.watch(settingsPath, (eventType, filename) => {
      if (eventType === 'change' && filename === 'settings.json') {
        console.log('📝 Settings file changed, clearing cache...');
        // Clear cache agar settings baru terbaca
        settingsCache = null;
        settingsCacheTime = 0;
        
        // Reload settings
        try {
          const newSettings = getSettingsWithCache();
          console.log('✅ Settings auto-reloaded successfully');
          console.log('📊 Current settings summary:');
          console.log(`   - OTP Length: ${newSettings.otp_length || 6}`);
          console.log(`   - RX Power Notification: ${newSettings.rx_power_notification_enable ? 'ON' : 'OFF'}`);
          console.log(`   - Server Port: ${newSettings.server_port || 4555}`);
        } catch (error) {
          console.error('❌ Error auto-reloading settings:', error.message);
        }
      }
    });
    
    console.log('👁️ Settings file watcher started');
  } catch (error) {
    console.error('❌ Error starting settings watcher:', error.message);
  }
}

// Mulai watcher saat modul dimuat
startSettingsWatcher();

module.exports = {
  getSettings,
  getSettingsWithCache,
  getSetting,
  getSettingsByKeys,
  startSettingsWatcher
}; 