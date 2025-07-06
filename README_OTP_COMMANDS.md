# Perintah Admin OTP Portal Pelanggan

## Deskripsi
Sistem ini menyediakan perintah admin untuk mengelola sistem OTP (One-Time Password) pada portal pelanggan melalui WhatsApp bot.

## Perintah yang Tersedia

### 1. `otp on` atau `otp enable`
**Fungsi:** Mengaktifkan sistem OTP untuk portal pelanggan

**Contoh:**
```
otp on
```

**Hasil:**
- Sistem OTP akan diaktifkan
- Pelanggan akan diminta memasukkan kode OTP saat login
- Kode OTP akan dikirim melalui WhatsApp

### 2. `otp off` atau `otp disable`
**Fungsi:** Menonaktifkan sistem OTP untuk portal pelanggan

**Contoh:**
```
otp off
```

**Hasil:**
- Sistem OTP akan dinonaktifkan
- Pelanggan dapat login langsung tanpa OTP
- Login akan langsung ke dashboard tanpa verifikasi

### 3. `otp status`
**Fungsi:** Menampilkan status sistem OTP

**Contoh:**
```
otp status
```

**Hasil:**
- Menampilkan status OTP (Aktif/Nonaktif)
- Menampilkan panjang kode OTP
- Menampilkan masa berlaku OTP
- Menampilkan daftar perintah yang tersedia

## Pengaturan yang Dikelola

Perintah ini mengelola pengaturan berikut di file `settings.json`:

- `customerPortalOtp`: Boolean - Status aktif/nonaktif OTP
- `customer_otp_enabled`: Boolean - Status aktif/nonaktif OTP (alternatif)
- `otp_length`: Number - Panjang kode OTP (default: 4)
- `otp_expiry_minutes`: Number - Masa berlaku OTP dalam menit (default: 5)

## Persyaratan

- Hanya admin yang dapat menggunakan perintah ini
- Sistem WhatsApp bot harus aktif
- File `settings.json` harus dapat diakses untuk pembacaan dan penulisan

## Integrasi dengan Menu

Perintah OTP juga tersedia di:
- Menu Admin (`admin`)
- Menu Help untuk admin (`menu`)

## Contoh Penggunaan Lengkap

```
Admin: otp status
Bot: 📊 STATUS OTP

🔐 Status: 🟢 AKTIF
📏 Panjang Kode: 4 digit
⏰ Masa Berlaku: 5 menit

Perintah yang tersedia:
• otp on - Aktifkan OTP
• otp off - Nonaktifkan OTP
• otp status - Lihat status OTP

Admin: otp off
Bot: ✅ OTP DINONAKTIFKAN

Sistem OTP untuk portal pelanggan telah dinonaktifkan.
Pelanggan dapat login langsung tanpa OTP.

Admin: otp on
Bot: ✅ OTP DIAKTIFKAN

Sistem OTP untuk portal pelanggan telah diaktifkan.
Pelanggan akan diminta memasukkan kode OTP saat login.
```

## Troubleshooting

### Jika perintah tidak berfungsi:
1. Pastikan Anda adalah admin yang terdaftar
2. Periksa apakah file `settings.json` dapat diakses
3. Restart bot WhatsApp jika diperlukan
4. Periksa log untuk error yang mungkin terjadi

### Jika OTP tidak terkirim:
1. Pastikan sistem WhatsApp bot terhubung
2. Periksa konfigurasi GenieACS
3. Pastikan nomor pelanggan terdaftar dalam sistem

## Versi
- **Versi:** 1.0.0
- **Tanggal:** 2024
- **Kompatibilitas:** WhatsApp Bot v1.0+ 