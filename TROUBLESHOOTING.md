# Troubleshooting Guide - Alijaya Hotspot WhatsApp Bot

## Masalah Umum dan Solusi

### 1. Error "Timed Out" pada WhatsApp

**Gejala:**
```
Error sending connection notification to admin: Error: Timed Out
```

**Penyebab:**
- Koneksi internet lambat atau tidak stabil
- Server WhatsApp sedang bermasalah
- Timeout setting terlalu pendek

**Solusi:**
- ✅ **Sudah diperbaiki**: Timeout ditingkatkan dari 30 detik ke 60 detik
- ✅ **Sudah diperbaiki**: Retry mechanism ditambahkan (3x retry)
- ✅ **Sudah diperbaiki**: Keep-alive connection ditambahkan
- ✅ **Sudah diperbaiki**: Fungsi validateAndSendMessage dengan timeout 45 detik

**Cara Manual:**
1. Restart aplikasi: `node app-whatsapp-only.js`
2. Cek koneksi internet
3. Tunggu 5-10 menit dan coba lagi

### 2. Error "Connection Closed" pada Validasi Nomor

**Gejala:**
```
Error validating WhatsApp number 6281947215703: Connection Closed
```

**Penyebab:**
- Koneksi WhatsApp terputus saat validasi
- Timeout validasi terlalu pendek

**Solusi:**
- ✅ **Sudah diperbaiki**: Timeout validasi ditingkatkan ke 10 detik
- ✅ **Sudah diperbaiki**: Error handling yang lebih baik

### 3. Error "Timed out after 10 seconds" pada Mikrotik

**Gejala:**
```
Mikrotik connection error: Timed out after 10 seconds
```

**Penyebab:**
- Koneksi ke Mikrotik lambat
- Firewall memblokir koneksi
- Port Mikrotik tidak terbuka

**Solusi:**
- ✅ **Sudah diperbaiki**: Timeout ditingkatkan ke 20 detik
- ✅ **Sudah diperbaiki**: Auto-reconnect ditambahkan
- ✅ **Sudah diperbaiki**: Keepalive connection ditambahkan

**Cara Manual:**
1. Cek koneksi ke Mikrotik: `ping 192.168.8.1`
2. Cek port Mikrotik: `telnet 192.168.8.1 8700`
3. Restart aplikasi jika perlu

### 4. Pesan Tidak Terkirim ke Admin

**Gejala:**
```
Error sending connection notification to admin utama: Error: Send timeout
```

**Penyebab:**
- Koneksi WhatsApp tidak stabil
- Nomor admin tidak valid
- Timeout pengiriman terlalu pendek

**Solusi:**
- ✅ **Sudah diperbaiki**: Menggunakan settings.json untuk admin numbers
- ✅ **Sudah diperbaiki**: Fungsi validateAndSendMessage dengan retry mechanism
- ✅ **Sudah diperbaiki**: Timeout pengiriman ditingkatkan ke 45 detik
- ✅ **Sudah diperbaiki**: Auto-retry dengan delay 15 detik

**Cara Manual:**
1. Cek konfigurasi admin di `settings.json`:
   ```json
   {
     "admins": ["6281947215703"]
   }
   ```

2. Test konfigurasi:
   ```bash
   node scripts/test-message.js
   ```

3. Restart aplikasi dengan auto-restart:
   ```bash
   node scripts/restart-on-error.js
   ```

### 5. Aplikasi Crash atau Hang

**Gejala:**
- Aplikasi berhenti berjalan
- Tidak ada response dari bot
- Error log menunjukkan crash

**Solusi:**
- ✅ **Sudah ditambahkan**: Auto-restart script
- ✅ **Sudah ditambahkan**: Connection monitoring

**Cara Manual:**
1. Gunakan script restart otomatis:
   ```bash
   node scripts/restart-on-error.js
   ```

2. Atau restart manual:
   ```bash
   # Stop aplikasi
   Ctrl+C
   
   # Start ulang
   node app-whatsapp-only.js
   ```

## Konfigurasi yang Diperbaiki

### Timeout Settings (settings.json)
```json
{
  "whatsapp_timeout": "60000",
  "whatsapp_retry_delay": "2000", 
  "whatsapp_max_retries": "3",
  "mikrotik_timeout": "20000",
  "mikrotik_retry_delay": "10000",
  "notification_timeout": "20000",
  "validation_timeout": "10000"
}
```

### Admin Configuration
```json
{
  "admins": ["6281947215703"],
  "admin_enabled": true
}
```

### Monitoring Otomatis
- **WhatsApp Monitoring**: Check setiap 30 detik
- **Mikrotik Monitoring**: Check setiap 60 detik
- **Auto-reconnect**: Otomatis reconnect jika terputus
- **Message Retry**: Auto-retry pengiriman pesan dengan delay

## Cara Menjalankan dengan Monitoring

### 1. Mode Normal
```bash
node app-whatsapp-only.js
```

### 2. Mode dengan Auto-Restart (Direkomendasikan)
```bash
node scripts/restart-on-error.js
```

### 3. Mode Debug (untuk troubleshooting)
```bash
DEBUG=* node app-whatsapp-only.js
```

### 4. Test Konfigurasi
```bash
node scripts/test-message.js
```

## Log Files

- **Aplikasi Log**: `logs/app.log`
- **Error Log**: `logs/error.log`
- **Exception Log**: `logs/exceptions.log`
- **Restart Log**: `logs/restart.log`

## Monitoring Status

Untuk mengecek status monitoring, gunakan command:
```
status
```

Response akan menampilkan:
- Status koneksi WhatsApp
- Status koneksi Mikrotik
- Status monitoring
- Uptime aplikasi

## Fungsi Baru yang Ditambahkan

### 1. validateAndSendMessage()
- Test koneksi WhatsApp sebelum mengirim
- Timeout 45 detik untuk pengiriman
- Error handling yang lebih baik

### 2. sendMessageWithRetry()
- Retry mechanism 3x dengan delay progresif
- Timeout 30 detik per attempt
- Logging yang detail

### 3. sendMessageToAdmin()
- Kirim pesan ke semua admin sekaligus
- Validasi nomor admin
- Summary hasil pengiriman

### 4. testWhatsAppConnection()
- Test koneksi WhatsApp secara real-time
- Validasi autentikasi
- Return status koneksi

## Tips Pencegahan

1. **Jalankan dengan Auto-Restart**: Selalu gunakan `scripts/restart-on-error.js`
2. **Monitor Logs**: Periksa log files secara berkala
3. **Backup Settings**: Backup `settings.json` secara berkala
4. **Update Dependencies**: Update npm packages secara berkala
5. **Cek Koneksi**: Pastikan koneksi internet stabil
6. **Test Konfigurasi**: Gunakan `scripts/test-message.js` untuk test

## Kontak Support

Jika masalah masih berlanjut:
1. Cek log files untuk detail error
2. Restart aplikasi dengan auto-restart script
3. Test konfigurasi dengan script test
4. Hubungi admin sistem

---

**Last Updated**: 6 Juli 2025
**Version**: 2.1 (dengan perbaikan pengiriman pesan admin) 