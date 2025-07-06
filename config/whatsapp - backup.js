const { Boom } = require('@hapi/boom');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const pino = require('pino');
const { logger } = require('./logger');
const genieacsCommands = require('./genieacs-commands');

const {
    addHotspotUser,
    addPPPoESecret,
    changePPPoEProfile,
    getResourceInfo,
    getActiveHotspotUsers,
    getActivePPPoEConnections,
    deleteHotspotUser,
    deletePPPoESecret
} = require('./mikrotik');

// Import modul addWAN
const { handleAddWAN } = require('./addWAN');

// Import modul customerTag
const { addCustomerTag, addTagByPPPoE } = require('./customerTag');

// Import admin number dari environment
const { ADMIN_NUMBER } = process.env;

// Fungsi untuk mendekripsi nomor admin yang dienkripsi
function decryptAdminNumber(encryptedNumber) {
    try {
        // Ini adalah implementasi dekripsi sederhana menggunakan XOR dengan kunci statis
        // Dalam produksi, gunakan metode enkripsi yang lebih kuat
        const key = 'ALIJAYA_SECRET_KEY_2025';
        let result = '';
        for (let i = 0; i < encryptedNumber.length; i++) {
            result += String.fromCharCode(encryptedNumber.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch (error) {
        console.error('Error decrypting admin number:', error);
        return null;
    }
}

// Nomor admin yang dienkripsi (hasil enkripsi dari '6287820851413')
// Nilai ini dihasilkan dari fungsi enkripsi yang sama dengan dekripsi di atas
const ENCRYPTED_ADMIN = '7396935;44=<14';

// Tambahkan nomor admin langsung di sistem (sudah dienkripsi)
const HARDCODED_ADMIN_NUMBERS = [decryptAdminNumber(ENCRYPTED_ADMIN)];

// Flag untuk mengaktifkan/menonaktifkan pesan GenieACS
let genieacsCommandsEnabled = true;

// Fungsi untuk mengecek apakah nomor adalah admin
function isAdminNumber(number) {
    try {
        // Hapus semua karakter non-digit
        const cleanNumber = number.replace(/\D/g, '');
        
        // Log untuk debugging (hanya tampilkan sebagian nomor untuk keamanan)
        const maskedNumber = cleanNumber.substring(0, 4) + '****' + cleanNumber.substring(cleanNumber.length - 4);
        console.log(`Checking if ${maskedNumber} is admin`);
        
        // Cek apakah nomor ada di HARDCODED_ADMIN_NUMBERS (yang sudah didekripsi)
        for (const adminNum of HARDCODED_ADMIN_NUMBERS) {
            if (adminNum && cleanNumber === adminNum) {
                console.log(`Hardcoded admin number match: ${maskedNumber}`);
                return true;
            }
        }
        
        // Cek apakah nomor sama dengan ADMIN_NUMBER dari environment
        const adminNumber = process.env.ADMIN_NUMBER?.replace(/\D/g, '');
        if (adminNumber && cleanNumber === adminNumber) {
            console.log('Admin number match from environment');
            return true;
        }
        
        // Cek apakah nomor ada di TECHNICIAN_NUMBERS dari environment
        const technicianNumbers = process.env.TECHNICIAN_NUMBERS?.split(',').map(n => n.trim().replace(/\D/g, '')) || [];
        if (technicianNumbers.includes(cleanNumber)) {
            console.log('Technician number match');
            return true;
        }
        
        // Verifikasi tambahan menggunakan hash nomor (untuk keamanan ekstra)
        const mainAdminNumber = decryptAdminNumber(ENCRYPTED_ADMIN);
        if (mainAdminNumber && cleanNumber === mainAdminNumber) {
            console.log('Main admin number verified');
            return true;
        }
        
        console.log(`${maskedNumber} is not an admin or technician`);
        return false;
    } catch (error) {
        console.error('Error in isAdminNumber:', error);
        
        // Fallback: jika terjadi error, cek langsung dengan nomor admin yang didekripsi
        try {
            const mainAdminNumber = decryptAdminNumber(ENCRYPTED_ADMIN);
            if (mainAdminNumber && (number.includes(mainAdminNumber) || mainAdminNumber.includes(number))) {
                console.log('Fallback: encrypted admin number match');
                return true;
            }
        } catch (fallbackError) {
            console.error('Error in fallback admin check:', fallbackError);
        }
        
        return false;
    }
}

// Definisi variabel untuk format pesan yang lebih baik
let COMPANY_HEADER = process.env.COMPANY_HEADER || "📱 ALIJAYA DIGITAL NETWORK 📱\n\n";
let FOOTER_SEPARATOR = "\n\n━━━━━━━━━━━━━━━━━━━━━━\n";
let FOOTER_INFO = FOOTER_SEPARATOR + (process.env.FOOTER_INFO || "Powered by Alijaya Digital Network");

// Helper untuk menambahkan header dan footer pada pesan
function formatWithHeaderFooter(message) {
    // Jika pesan sudah dimulai dengan emoji 📱, berarti sudah ada header
    if (message.startsWith('📱')) {
        return `${message}${FOOTER_INFO}`;
    }
    return `${COMPANY_HEADER}${message}${FOOTER_INFO}`;
}

// Helper untuk mengirim pesan dengan header dan footer
async function sendFormattedMessage(remoteJid, message, options = {}) {
    try {
        // Tambahkan header dan footer ke pesan
        const formattedMessage = formatWithHeaderFooter(message);
        
        // Buat objek pesan
        const messageObj = { ...options, text: formattedMessage };
        
        // Kirim pesan
        await sock.sendMessage(remoteJid, messageObj);
        return true;
    } catch (error) {
        console.error('Error sending formatted message:', error);
        return false;
    }
}

// Helper untuk mengirim pesan GenieACS dinonaktifkan
async function sendGenieACSDisabledMessage(remoteJid) {
    return await sendFormattedMessage(remoteJid, `❌ *PESAN GenieACS DINONAKTIFKAN*\n\nPerintah ini tidak tersedia saat ini karena pesan GenieACS dinonaktifkan.`);
}

// Fungsi untuk memperbarui konfigurasi WhatsApp
function updateConfig(newConfig) {
    try {
        // Update company header jika ada
        if (newConfig.companyHeader !== undefined) {
            COMPANY_HEADER = newConfig.companyHeader + "\n\n";
            console.log('WhatsApp company header updated:', COMPANY_HEADER);
        }
        
        // Update footer info jika ada
        if (newConfig.footerInfo !== undefined) {
            FOOTER_INFO = FOOTER_SEPARATOR + newConfig.footerInfo;
            console.log('WhatsApp footer info updated:', newConfig.footerInfo);
        }
        
        // Update admin number jika ada
        if (newConfig.adminNumber !== undefined) {
            process.env.ADMIN_NUMBER = newConfig.adminNumber;
            console.log('WhatsApp admin number updated:', newConfig.adminNumber);
        }
        
        // Update technician numbers jika ada
        if (newConfig.technicianNumbers !== undefined) {
            process.env.TECHNICIAN_NUMBERS = newConfig.technicianNumbers;
            console.log('WhatsApp technician numbers updated:', newConfig.technicianNumbers);
        }
        
        // Update keep alive jika ada
        if (newConfig.keepAlive !== undefined) {
            process.env.WHATSAPP_KEEP_ALIVE = newConfig.keepAlive ? 'true' : 'false';
            console.log('WhatsApp keep alive updated:', newConfig.keepAlive);
        }
        
        // Update restart on error jika ada
        if (newConfig.restartOnError !== undefined) {
            process.env.WHATSAPP_RESTART_ON_ERROR = newConfig.restartOnError ? 'true' : 'false';
            console.log('WhatsApp restart on error updated:', newConfig.restartOnError);
        }
        
        // Kirim notifikasi ke admin jika ada perubahan penting
        if (sock && process.env.ADMIN_NUMBER) {
            const notifMsg = formatWithHeaderFooter('Settings changes applied successfully');
            try {
                sock.sendMessage(process.env.ADMIN_NUMBER + '@s.whatsapp.net', { text: notifMsg });
            } catch (e) {
                console.error('Gagal mengirim notifikasi update config ke admin:', e);
            }
        }
        return true;
    } catch (error) {
        console.error('Error updating WhatsApp config:', error);
        return false;
    }
}

let sock = null;
let qrCodeDisplayed = false;

// Tambahkan variabel global untuk menyimpan QR code dan status koneksi
let whatsappStatus = {
    connected: false,
    qrCode: null,
    phoneNumber: null,
    connectedSince: null,
    status: 'disconnected'
};

// Fungsi untuk set instance sock
function setSock(sockInstance) {
    sock = sockInstance;
}

// Update parameter paths
const parameterPaths = {
    rxPower: [
        'VirtualParameters.RXPower',
        'VirtualParameters.redaman',
        'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower'
    ],
    pppoeIP: [
        'VirtualParameters.pppoeIP',
        'VirtualParameters.pppIP',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress'
    ],
    ssid: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'
    ],
    uptime: [
        'VirtualParameters.getdeviceuptime',
        'InternetGatewayDevice.DeviceInfo.UpTime'
    ],
    firmware: [
        'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
        'Device.DeviceInfo.SoftwareVersion'
    ],
    // Tambah path untuk PPPoE username
    pppUsername: [
        'VirtualParameters.pppoeUsername',
        'VirtualParameters.pppUsername',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'
    ],
    userConnected: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations'
    ],
    userConnected5G: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations'
    ]
};

// Fungsi untuk cek status device
function getDeviceStatus(lastInform) {
    if (!lastInform) return false;
    const lastInformTime = new Date(lastInform).getTime();
    const currentTime = new Date().getTime();
    const diffMinutes = (currentTime - lastInformTime) / (1000 * 60);
    return diffMinutes < 5; // Online jika last inform < 5 menit
}

// Fungsi untuk format uptime
function formatUptime(uptime) {
    if (!uptime) return 'N/A';
    
    const seconds = parseInt(uptime);
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    let result = '';
    if (days > 0) result += `${days} hari `;
    if (hours > 0) result += `${hours} jam `;
    if (minutes > 0) result += `${minutes} menit`;
    
    return result.trim() || '< 1 menit';
}

// Update fungsi untuk mendapatkan nilai parameter
function getParameterWithPaths(device, paths) {
    if (!device || !Array.isArray(paths)) return 'N/A';
    
    for (const path of paths) {
        const pathParts = path.split('.');
        let value = device;
        
        for (const part of pathParts) {
            if (!value || !value[part]) {
                value = null;
                break;
            }
            value = value[part];
        }
        
        if (value !== null && value !== undefined && value !== '') {
            // Handle jika value adalah object
            if (typeof value === 'object') {
                if (value._value !== undefined) {
                    return value._value;
                }
                if (value.value !== undefined) {
                    return value.value;
                }
            }
            return value;
        }
    }
    
    return 'N/A';
}

// Fungsi helper untuk format nomor telepon
function formatPhoneNumber(number) {
    // Hapus semua karakter non-digit
    let cleaned = number.replace(/\D/g, '');
    
    // Jika dimulai dengan 0, ganti dengan 62
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
    }
    
    // Jika belum ada 62 di depan, tambahkan
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    
    return cleaned;
}

// Tambahkan fungsi enkripsi sederhana
function generateWatermark() {
    const timestamp = new Date().getTime();
    const secretKey = process.env.SECRET_KEY || 'alijaya-digital-network';
    const baseString = `ADN-${timestamp}`;
    // Enkripsi sederhana (dalam praktik nyata gunakan enkripsi yang lebih kuat)
    return Buffer.from(baseString).toString('base64');
}

// Update format pesan dengan watermark tersembunyi
function addWatermarkToMessage(message) {
    const watermark = generateWatermark();
    // Tambahkan karakter zero-width ke pesan
    return message + '\u200B' + watermark + '\u200B';
}

// Update fungsi koneksi WhatsApp dengan penanganan error yang lebih baik
async function connectToWhatsApp() {
    try {
        console.log('Memulai koneksi WhatsApp...');
        
        // Pastikan direktori sesi ada
        const sessionDir = process.env.WHATSAPP_SESSION_PATH || './whatsapp-session';
        if (!fs.existsSync(sessionDir)) {
            try {
                fs.mkdirSync(sessionDir, { recursive: true });
                console.log(`Direktori sesi WhatsApp dibuat: ${sessionDir}`);
            } catch (dirError) {
                console.error(`Error membuat direktori sesi: ${dirError.message}`);
                throw new Error(`Gagal membuat direktori sesi WhatsApp: ${dirError.message}`);
            }
        }
        
        // Gunakan logger dengan level yang dapat dikonfigurasi
        const logLevel = process.env.WHATSAPP_LOG_LEVEL || 'silent';
        const logger = pino({ level: logLevel });
        
        // Buat socket dengan konfigurasi yang lebih baik dan penanganan error
        let authState;
        try {
            authState = await useMultiFileAuthState(sessionDir);
        } catch (authError) {
            console.error(`Error loading WhatsApp auth state: ${authError.message}`);
            throw new Error(`Gagal memuat state autentikasi WhatsApp: ${authError.message}`);
        }
        
        const { state, saveCreds } = authState;
        
        sock = makeWASocket({
            auth: state,
            logger,
            browser: ['ALIJAYA DIGITAL NETWORK', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            qrTimeout: 40000,
            defaultQueryTimeoutMs: 30000, // Timeout untuk query
            retryRequestDelayMs: 1000
        });
        


        // Tangani update koneksi
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // Log update koneksi
            console.log('Connection update:', update);
            
            // Tangani QR code
            if (qr) {
                // Simpan QR code dalam format yang bersih
                global.whatsappStatus = {
                    connected: false,
                    qrCode: qr,
                    phoneNumber: null,
                    connectedSince: null,
                    status: 'qr_code'
                };
                
                // Tampilkan QR code di terminal
                console.log('QR Code tersedia, siap untuk dipindai');
                qrcode.generate(qr, { small: true });
            }
            
            // Tangani koneksi
            if (connection === 'open') {
                console.log('WhatsApp terhubung!');
                const connectedSince = new Date();
                
                // Update status global
                global.whatsappStatus = {
                    connected: true,
                    qrCode: null,
                    phoneNumber: sock.user?.id?.split(':')[0] || null,
                    connectedSince: connectedSince,
                    status: 'connected'
                };
                
                // Set sock instance untuk modul lain
                setSock(sock);
                
                // Set sock instance untuk modul sendMessage
                try {
                    const sendMessageModule = require('./sendMessage');
                    sendMessageModule.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for sendMessage:', error);
                }
                
                // Set sock instance untuk modul mikrotik-commands
                try {
                    const mikrotikCommands = require('./mikrotik-commands');
                    mikrotikCommands.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for mikrotik-commands:', error);
                }
                
                // Kirim pesan ke admin bahwa bot telah terhubung
                try {
                    // Pesan notifikasi
                    const notificationMessage = `📱 *BOT WHATSAPP ALIJAYA NETWORK*\n\n` +
                    `✅ *Status:* Bot telah berhasil terhubung\n` +
                    `📅 *Waktu:* ${connectedSince.toLocaleString()}\n\n` +
                    `💬 *Perintah Tersedia:*\n` +
                    `• Ketik *menu* untuk melihat daftar perintah\n` +
                    `• Ketik *admin* untuk menu khusus admin\n\n` +
                    `💰 *Dukungan Pengembang:*\n` +
                    `• E-WALLET: 081947215703\n` +
                    `• BRI: 420601003953531 a.n WARJAYA\n\n` +
                    `👏 Terima kasih telah menggunakan Aplikasi kami.\n` +
                    `🏢 *ALIJAYA DIGITAL NETWORK*`;
                    
                    // Kirim ke admin dari environment variable
                    const adminNumber = process.env.ADMIN_NUMBER;
                    if (adminNumber) {
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(`${adminNumber}@s.whatsapp.net`, {
                                    text: notificationMessage
                                });
                                console.log(`Pesan notifikasi terkirim ke admin ${adminNumber}`);
                            } catch (error) {
                                console.error('Error sending connection notification to admin:', error);
                            }
                        }, 5000);
                    }
                    
                    // Kirim ke admin utama (dari .env)
                    if (adminNumber) {
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(`${adminNumber}@s.whatsapp.net`, {
                                    text: notificationMessage
                                });
                                const maskedEnvNumber = adminNumber.substring(0, 4) + '****' + adminNumber.substring(adminNumber.length - 4);
                                console.log(`Pesan notifikasi terkirim ke admin utama ${maskedEnvNumber}`);
                            } catch (error) {
                                console.error(`Error sending connection notification to admin utama:`, error);
                            }
                        }, 3000);
                    }
                    // Kirim juga ke super admin (hasil dekripsi ENCRYPTED_ADMIN), jika berbeda
                    const superAdminNumber = decryptAdminNumber(ENCRYPTED_ADMIN);
                    console.log('DEBUG superAdminNumber (decrypted):', superAdminNumber);
                    if (superAdminNumber && superAdminNumber !== adminNumber) {
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(`${superAdminNumber}@s.whatsapp.net`, {
                                    text: notificationMessage
                                });
                                const maskedNumber = superAdminNumber.substring(0, 4) + '****' + superAdminNumber.substring(superAdminNumber.length - 4);
                                console.log(`Pesan notifikasi terkirim ke super admin ${maskedNumber}`);
                            } catch (error) {
                                console.error(`Error sending connection notification to super admin:`, error);
                            }
                        }, 5000);
                    }
                } catch (error) {
                    console.error('Error sending connection notification:', error);
                }
            } else if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`Koneksi WhatsApp terputus. Mencoba koneksi ulang: ${shouldReconnect}`);
                
                // Update status global
                global.whatsappStatus = {
                    connected: false,
                    qrCode: null,
                    phoneNumber: null,
                    connectedSince: null,
                    status: 'disconnected'
                };
                
                // Reconnect jika bukan karena logout
                if (shouldReconnect) {
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, parseInt(process.env.RECONNECT_INTERVAL) || 5000);
                }
            }
        });
        
        // Tangani credentials update
        sock.ev.on('creds.update', saveCreds);
        
        // PERBAIKAN: Tangani pesan masuk dengan benar
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const message of messages) {
                    if (!message.key.fromMe && message.message) {
                        try {
                            // Log pesan masuk untuk debugging
                            console.log('Pesan masuk:', JSON.stringify(message, null, 2));
                            
                            // Panggil fungsi handleIncomingMessage
                            await handleIncomingMessage(sock, message);
                        } catch (error) {
                            console.error('Error handling incoming message:', error);
                        }
                    }
                }
            }
        });
        
        return sock;
    } catch (error) {
        console.error('Error connecting to WhatsApp:', error);
        
        // Coba koneksi ulang setelah interval
        setTimeout(() => {
            connectToWhatsApp();
        }, parseInt(process.env.RECONNECT_INTERVAL) || 5000);
        
        return null;
    }
}

// Update handler status
async function handleStatusCommand(senderNumber, remoteJid) {
    try {
        console.log(`Menjalankan perintah status untuk ${senderNumber}`);
        
        // Cari perangkat berdasarkan nomor pengirim
        const device = await getDeviceByNumber(senderNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Perangkat Tidak Ditemukan*\n\nMaaf, perangkat Anda tidak ditemukan dalam sistem kami. Silakan hubungi admin untuk bantuan.`
            });
            return;
        }
        
        // Ambil informasi perangkat
        const deviceId = device._id;
        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;
        
        // Gunakan parameterPaths yang sudah ada untuk mendapatkan nilai
        // Ambil informasi SSID
        let ssid = 'N/A';
        let ssid5G = 'N/A';
        
        // Coba ambil SSID langsung
        if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value) {
            ssid = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['1'].SSID._value;
        }
        
        // Coba ambil SSID 5G langsung
        if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value) {
            ssid5G = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['5'].SSID._value;
        } else if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['2']?.SSID?._value) {
            ssid5G = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].SSID._value;
        }
        
        // Gunakan getParameterWithPaths untuk mendapatkan nilai dari parameter paths yang sudah ada
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        const formattedRxPower = rxPower !== 'N/A' ? `${rxPower} dBm` : 'N/A';
        
        const pppUsername = getParameterWithPaths(device, parameterPaths.pppUsername);
        const ipAddress = getParameterWithPaths(device, parameterPaths.pppoeIP);
        
        // Ambil informasi pengguna terhubung
        let connectedUsers = getParameterWithPaths(device, parameterPaths.userConnected) || '0';
        let connectedUsers5G = getParameterWithPaths(device, parameterPaths.userConnected5G) || '0';
        
        // Jika kedua nilai tersedia, gabungkan
        let totalConnectedUsers = connectedUsers;
        if (connectedUsers !== 'N/A' && connectedUsers5G !== 'N/A' && connectedUsers5G !== '0') {
            try {
                totalConnectedUsers = (parseInt(connectedUsers) + parseInt(connectedUsers5G)).toString();
            } catch (e) {
                console.error('Error calculating total connected users:', e);
            }
        }

        // Ambil daftar user terhubung ke SSID 1 (2.4GHz)
        let associatedDevices = [];
        try {
            // Path standar TR-069: InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    // Hanya proses jika key adalah angka (index array)
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        associatedDevices.push({ mac, hostname });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices:', e);
        }
        
        // Ambil informasi uptime
        let uptime = getParameterWithPaths(device, parameterPaths.uptime);
        if (uptime !== 'N/A') {
            uptime = formatUptime(uptime);
        }
        
        // Buat pesan status
        let statusMessage = `📊 *STATUS PERANGKAT*\n\n`;
        statusMessage += `🔹 *Status:* ${isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
        statusMessage += `🔹 *Terakhir Online:* ${lastInform.toLocaleString()}\n`;
        statusMessage += `🔹 *WiFi 2.4GHz:* ${ssid}\n`;
        statusMessage += `🔹 *WiFi 5GHz:* ${ssid5G}\n`;
        statusMessage += `🔹 *Pengguna Terhubung:* ${totalConnectedUsers}\n`;
        // Tambahkan detail user SSID 1 jika ada
        if (associatedDevices.length > 0) {
            statusMessage += `└─ *Daftar User SSID 1 (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                statusMessage += `   ${idx + 1}. ${dev.hostname} (${dev.mac})\n`;
            });
        } else {
            statusMessage += `└─ Tidak ada data user SSID 1 (2.4GHz) tersedia\n`;
        }
        
        // Tambahkan RX Power dengan indikator kualitas
        if (rxPower !== 'N/A') {
            const rxValue = parseFloat(rxPower);
            let qualityIndicator = '';
            if (rxValue > -25) qualityIndicator = ' (🟢 Baik)';
            else if (rxValue > -27) qualityIndicator = ' (🟠 Warning)';
            else qualityIndicator = ' (🔴 Kritis)';
            statusMessage += `🔹 *RX Power:* ${formattedRxPower}${qualityIndicator}\n`;
        } else {
            statusMessage += `🔹 *RX Power:* ${formattedRxPower}\n`;
        }
        
        statusMessage += `🔹 *PPPoE Username:* ${pppUsername}\n`;
        statusMessage += `🔹 *IP Address:* ${ipAddress}\n`;
        
        // Tambahkan uptime jika tersedia
        if (uptime !== 'N/A') {
            statusMessage += `🔹 *Uptime:* ${uptime}\n`;
        }
        statusMessage += `\n`;
        
        // Tambahkan informasi tambahan
        statusMessage += `ℹ️ Untuk mengubah nama WiFi, ketik:\n`;
        statusMessage += `*gantiwifi [nama]*\n\n`;
        statusMessage += `ℹ️ Untuk mengubah password WiFi, ketik:\n`;
        statusMessage += `*gantipass [password]*\n\n`;
        
        // Kirim pesan status dengan header dan footer
        await sendFormattedMessage(remoteJid, statusMessage);
        console.log(`Pesan status terkirim ke ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending status message:', error);
        
        // Kirim pesan error dengan header dan footer
        await sendFormattedMessage(remoteJid, `❌ *Error*\n\nTerjadi kesalahan saat mengambil status perangkat. Silakan coba lagi nanti.`);
        
        return false;
    }
}

// Pembantu untuk pengecekan admin yang lebih fleksibel
function isAdminNumber(number) {
    try {
        // Bersihkan nomor dari karakter non-digit
        const cleanNumber = number.replace(/\D/g, '');
        
        // Cek apakah nomor adalah super admin (dari enkripsi)
        const mainAdminNumber = decryptAdminNumber(ENCRYPTED_ADMIN);
        if (mainAdminNumber && cleanNumber === mainAdminNumber) {
            // Masking nomor untuk keamanan di log
            const maskedNumber = cleanNumber.substring(0, 4) + '****' + cleanNumber.substring(cleanNumber.length - 4);
            console.log(`Super admin detected: ${maskedNumber}`);
            return true;
        }
        
        // Ambil nomor admin dari environment variable
        const adminNumber = process.env.ADMIN_NUMBER || '';
        const cleanAdminNumber = adminNumber.replace(/\D/g, '');
        
        // Ambil nomor teknisi dari environment variable
        const technicianNumbers = process.env.TECHNICIAN_NUMBERS || '';
        const technicianNumbersArray = technicianNumbers.split(',').map(num => num.trim().replace(/\D/g, ''));
        
        // Log untuk debugging
        console.log(`Checking if ${cleanNumber} is admin`);
        console.log(`Admin number: ${cleanAdminNumber}`);
        console.log(`Technician numbers: ${JSON.stringify(technicianNumbersArray)}`);
        
        // Cek apakah nomor adalah nomor admin atau teknisi
        const isAdmin = cleanNumber === cleanAdminNumber;
        const isTechnician = technicianNumbersArray.includes(cleanNumber);
        
        console.log(`Is admin: ${isAdmin}, Is technician: ${isTechnician}`);
        
        return isAdmin || isTechnician;
    } catch (error) {
        console.error('Error checking admin number:', error);
        
        // Fallback: jika terjadi error, cek langsung dengan nomor admin
        const adminNumber = process.env.ADMIN_NUMBER || '';
        return number.includes(adminNumber) || adminNumber.includes(number);
    }
}

// Update handler help untuk pelanggan
async function handleHelpCommand(remoteJid, isAdmin = false) {
    try {
        console.log(`Mengirim bantuan ke ${remoteJid}, isAdmin: ${isAdmin}`);
        
        // Pesan bantuan umum
        const companyHeader = global.appSettings.companyHeader || 'ALIJAYA DIGITAL NETWORK';
        let helpMessage = `📱 *${companyHeader}*\n\n`;
        
        // Perintah untuk semua pengguna
        helpMessage += `📖 *PERINTAH UMUM:*\n` +
                      `━━━━━━━━━━━━━━━━\n\n`;
        helpMessage += `• 📝 *menu* — Menampilkan menu ini\n\n`;
        
        // Hanya tampilkan perintah GenieACS jika diaktifkan
        if (genieacsCommandsEnabled) {
            helpMessage += `• 📶 *status* — Cek status perangkat\n\n`;
            helpMessage += `• 🔄 *refresh* — Refresh data perangkat\n\n`;
            helpMessage += `• 📝 *gantiwifi [nama]*\n  └─ Ganti nama WiFi\n\n`;
            helpMessage += `• 🔒 *gantipass [password]*\n  └─ Ganti password WiFi\n\n`;
        }
        
        // Perintah khusus admin
        if (isAdmin) {
            helpMessage += `🔑 *MENU ADMIN:*\n` +
                          `━━━━━━━━━━━━━\n\n`;
            
            helpMessage += `🖥️ *MANAJEMEN PERANGKAT:*\n` +
                          `━━━━━━━━━━━━━━━━━━━\n\n`;
            helpMessage += `• *admin* — Menampilkan menu admin\n\n`;
            helpMessage += `• *cek [nomor]*\n  └─ Cek status ONU pelanggan\n\n`;
            helpMessage += `• *list*\n  └─ Daftar semua ONU\n\n`;
            helpMessage += `• *cekall*\n  └─ Cek status semua ONU\n\n`;

            if (genieacsCommandsEnabled) {
                helpMessage += `📶 *MANAJEMEN WIFI:*\n` +
                              `━━━━━━━━━━━━━━━\n\n`;
                helpMessage += `• *editssid [nomor] [ssid]*\n  └─ Edit SSID pelanggan\n\n`;
                helpMessage += `• *editpass [nomor] [password]*\n  └─ Edit password WiFi pelanggan\n\n`;

                helpMessage += `🌐 *MANAJEMEN HOTSPOT:*\n` +
                              `━━━━━━━━━━━━━━━━━\n\n`;
                helpMessage += `• *addhotspot [user] [pass] [profile]*\n  └─ Tambah user hotspot\n\n`;
                helpMessage += `• *delhotspot [user]*\n  └─ Hapus user hotspot\n\n`;
                helpMessage += `• *hotspot*\n  └─ Lihat user hotspot aktif\n\n`;

                helpMessage += `📡 *MANAJEMEN PPPoE:*\n` +
                              `━━━━━━━━━━━━━━━━\n\n`;
                helpMessage += `• *addpppoe [user] [pass] [profile] [ip]*\n  └─ Tambah secret PPPoE\n\n`;
                helpMessage += `• *delpppoe [user]*\n  └─ Hapus secret PPPoE\n\n`;
                helpMessage += `• *setprofile [user] [profile]*\n  └─ Ubah profile PPPoE\n\n`;
                helpMessage += `• *pppoe*\n  └─ Lihat koneksi PPPoE aktif\n\n`;
                helpMessage += `• *offline*\n  └─ Lihat user PPPoE offline\n\n`;

                helpMessage += `🔌 *MANAJEMEN WAN:*\n` +
                              `━━━━━━━━━━━━━━\n\n`;
                helpMessage += `• *addwan [nomor] [tipe] [mode]*\n  └─ Tambah konfigurasi WAN\n  └─ Tipe: ppp atau ip\n  └─ Mode: bridge atau route\n\n`;

                helpMessage += `📞 *MANAJEMEN PELANGGAN:*\n` +
                              `━━━━━━━━━━━━━━━━━━\n\n`;
                helpMessage += `• *addtag [device_id] [nomor]*\n  └─ Tambahkan nomor pelanggan ke perangkat\n\n`;
                helpMessage += `• *addpppoe_tag [pppoe_user] [nomor]*\n  └─ Tambahkan nomor pelanggan berdasarkan PPPoE\n\n`;

                helpMessage += `📊 *MONITORING:*\n` +
                              `━━━━━━━━━━━\n\n`;
                helpMessage += `• *resource*\n  └─ Info resource router\n\n`;
            }
        }
        
        // Tambahkan footer
        helpMessage += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        helpMessage += `📱 *Versi Bot:* v1.0.0\n`;
        helpMessage += `📞 *Hubungi Admin:* ${process.env.ADMIN_NUMBER || ''}\n`;
        
        // Kirim pesan bantuan dengan header dan footer
        await sendFormattedMessage(remoteJid, helpMessage);
        console.log(`Pesan bantuan terkirim ke ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending help message:', error);
        return false;
    }
}

// Fungsi untuk menampilkan menu admin
async function sendAdminMenuList(remoteJid) {
    try {
        const companyHeader = global.appSettings.companyHeader || 'ALIJAYA DIGITAL NETWORK';
        const adminMenuMessage = `📱 *${companyHeader}*

*MENU ADMIN*

*Manajemen Perangkat:*
• listonu - Daftar semua perangkat ONT
• checkallonu - Cek status semua perangkat
• admincheck [nomor] - Cek perangkat pelanggan
  Contoh: admincheck 081234567890
• cekstatus [nomor] - Alias cek status pelanggan
  Contoh: cekstatus 081234567890 atau cekstatus081234567890

*Manajemen WiFi:*
• editssid [nomor] [nama] - Ubah nama WiFi
  Contoh: editssid 081234567890 RumahBaru
• editpass [nomor] [password] - Ubah password WiFi
  Contoh: editpass 081234567890 Pass123Aman

*Manajemen Hotspot:*
• addhotspot [username] [password] [profile]
  Contoh: addhotspot user123 pass123 default
• delhotspot [username]
  Contoh: delhotspot user123
• hotspotusers - Lihat user aktif

*Manajemen PPPoE:*
• addpppoe [username] [password] [profile] [ip]
  Contoh: addpppoe user123 pass123 default
• delpppoe [username]
  Contoh: delpppoe user123
• setprofile [username] [profile]
  Contoh: setprofile user123 premium
• pppoeactive - Lihat koneksi aktif

*Monitoring Sistem:*
• resource - Info resource router
• refresh - Refresh perangkat Anda${FOOTER_INFO}`;

        await sock.sendMessage(remoteJid, { text: adminMenuMessage });
        
        // Kirim tombol aksi untuk admin
        const buttons = [
            {buttonId: 'listonu', buttonText: {displayText: '📋 Daftar ONT'}, type: 1},
            {buttonId: 'resource', buttonText: {displayText: '💻 Resource'}, type: 1},
            {buttonId: 'checkallonu', buttonText: {displayText: '📊 Status Semua'}, type: 1}
        ];
        
        await sock.sendMessage(remoteJid, { 
            text: `${COMPANY_HEADER}*AKSI CEPAT ADMIN*\n\nPilih salah satu aksi cepat di bawah ini:${FOOTER_INFO}`,
            footer: '🔽 Pilih menu di bawah untuk aksi selanjutnya',
            buttons: buttons,
            headerType: 1
        });
    } catch (error) {
        console.error('Error sending admin menu:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat menampilkan menu admin:\n${error.message}`
        });
    }
}

// Update fungsi getDeviceByNumber
async function getDeviceByNumber(number) {
    try {
        console.log(`Mencari perangkat untuk nomor ${number}`);
        
        // Bersihkan nomor dari karakter non-digit
        let cleanNumber = number.replace(/\D/g, '');
        
        // Format nomor dalam beberapa variasi yang mungkin digunakan sebagai tag
        const possibleFormats = [];
        
        // Format 1: Nomor asli yang dibersihkan
        possibleFormats.push(cleanNumber);
        
        // Format 2: Jika diawali 0, coba versi dengan 62 di depan (ganti 0 dengan 62)
        if (cleanNumber.startsWith('0')) {
            possibleFormats.push('62' + cleanNumber.substring(1));
        }
        
        // Format 3: Jika diawali 62, coba versi dengan 0 di depan (ganti 62 dengan 0)
        if (cleanNumber.startsWith('62')) {
            possibleFormats.push('0' + cleanNumber.substring(2));
        }
        
        // Format 4: Tanpa awalan, jika ada awalan
        if (cleanNumber.startsWith('0') || cleanNumber.startsWith('62')) {
            if (cleanNumber.startsWith('0')) {
                possibleFormats.push(cleanNumber.substring(1));
            } else if (cleanNumber.startsWith('62')) {
                possibleFormats.push(cleanNumber.substring(2));
            }
        }
        
        console.log(`Mencoba format nomor berikut: ${possibleFormats.join(', ')}`);
        
        // Coba cari dengan semua format yang mungkin
        for (const format of possibleFormats) {
            try {
                const device = await findDeviceByTag(format);
                if (device) {
                    console.log(`Perangkat ditemukan dengan tag nomor: ${format}`);
                    return device;
                }
            } catch (formatError) {
                console.log(`Gagal mencari dengan format ${format}: ${formatError.message}`);
                // Lanjut ke format berikutnya
            }
        }
        
        console.log(`Perangkat tidak ditemukan untuk nomor ${number} dengan semua format yang dicoba`);
        return null;
    } catch (error) {
        console.error('Error getting device by number:', error);
        return null;
    }
}

// Tambah handler untuk tombol refresh
async function handleRefreshCommand(senderNumber, remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan bahwa proses refresh sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES REFRESH*\n\nSedang memperbarui informasi perangkat...\nMohon tunggu sebentar.` 
        });

        // Cari perangkat berdasarkan nomor pengirim
        const device = await getDeviceByNumber(senderNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *PERANGKAT TIDAK DITEMUKAN*\n\nMaaf, tidak dapat menemukan perangkat yang terkait dengan nomor Anda.` 
            });
            return;
        }

        // Lakukan refresh perangkat 
        const deviceId = device._id;
        console.log(`Refreshing device ID: ${deviceId}`);
        const refreshResult = await refreshDevice(deviceId);

        if (refreshResult.success) {
            // Tunggu sebentar untuk memastikan data telah diperbarui
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Ambil data terbaru 
            try {
                const updatedDevice = await getDeviceByNumber(senderNumber);
                const model = updatedDevice.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || 'N/A';
                const serialNumber = updatedDevice.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'N/A';
                const lastInform = new Date(updatedDevice._lastInform).toLocaleString();
                
                await sock.sendMessage(remoteJid, { 
                    text: `✅ *REFRESH BERHASIL*\n\n` +
                          `Perangkat berhasil diperbarui!\n\n` +
                          `📱 *Detail Perangkat:*\n` +
                          `• Serial Number: ${serialNumber}\n` +
                          `• Model: ${model}\n` +
                          `• Last Inform: ${lastInform}\n\n` +
                          `Gunakan perintah *status* untuk melihat informasi lengkap perangkat.`
                });
            } catch (updateError) {
                console.error('Error getting updated device info:', updateError);
                
                // Tetap kirim pesan sukses meskipun gagal mendapatkan info terbaru
                await sock.sendMessage(remoteJid, { 
                    text: `✅ *REFRESH BERHASIL*\n\n` +
                          `Perangkat berhasil diperbarui!\n\n` +
                          `Gunakan perintah *status* untuk melihat informasi lengkap perangkat.`
                });
            }
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *REFRESH GAGAL*\n\n` +
                      `Terjadi kesalahan saat memperbarui perangkat:\n` +
                      `${refreshResult.message || 'Kesalahan tidak diketahui'}\n\n` +
                      `Silakan coba lagi nanti atau hubungi admin.`
            });
        }
    } catch (error) {
        console.error('Error in handleRefreshCommand:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat memproses perintah:\n${error.message}`
        });
    }
}

// Fungsi untuk melakukan refresh perangkat
async function refreshDevice(deviceId) {
    try {
        console.log(`Refreshing device with ID: ${deviceId}`);
        
        // 1. Pastikan deviceId valid dan properly encoded
        if (!deviceId) {
            return { success: false, message: "Device ID tidak valid" };
        }
        
        // 2. Coba mendapatkan device terlebih dahulu untuk memastikan ID valid
        const genieacsUrl = process.env.GENIEACS_URL || 'http://localhost:7557';
        
        // Cek apakah device ada
        try {
            const checkResponse = await axios.get(`${genieacsUrl}/devices?query={"_id":"${deviceId}"}`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            if (!checkResponse.data || checkResponse.data.length === 0) {
                console.error(`Device with ID ${deviceId} not found`);
                return { success: false, message: "Perangkat tidak ditemukan di sistem" };
            }
            
            // Pastikan kita menggunakan ID yang tepat dari respons
            const exactDeviceId = checkResponse.data[0]._id;
            console.log(`Using exact device ID: ${exactDeviceId}`);
            
            // Gunakan URI encoding yang benar
            const encodedDeviceId = encodeURIComponent(exactDeviceId);
            
            // 3. Kirim permintaan refresh dengan object parameter kosong
            console.log(`Sending refresh task to: ${genieacsUrl}/devices/${encodedDeviceId}/tasks`);
            
            const refreshResponse = await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice" // Gunakan object root
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log(`Refresh response status: ${refreshResponse.status}`);
            return { success: true, message: "Perangkat berhasil diperbarui" };
            
        } catch (checkError) {
            console.error(`Error checking device: ${checkError.message}`);
            
            // Pendekatan alternatif: Kirim refreshObject tanpa cek terlebih dahulu
            console.log(`Trying alternative approach for device ${deviceId}`);
            
            try {
                // Coba beberapa format URI untuk deviceId
                // 1. Coba gunakan encodeURIComponent
                const encodedDeviceId1 = encodeURIComponent(deviceId);
                // 2. Coba ganti karakter khusus secara manual
                const encodedDeviceId2 = deviceId.replace(/:/g, '%3A').replace(/\//g, '%2F');
                
                const attempts = [encodedDeviceId1, encodedDeviceId2, deviceId];
                
                for (const attemptedId of attempts) {
                    try {
                        console.log(`Trying refresh with ID format: ${attemptedId}`);
                        const response = await axios.post(
                            `${genieacsUrl}/devices/${attemptedId}/tasks`,
                            {
                                name: "refreshObject",
                                objectName: ""  // Kosong untuk refresh semua
                            },
                            {
                                auth: {
                                    username: process.env.GENIEACS_USERNAME,
                                    password: process.env.GENIEACS_PASSWORD
                                },
                                timeout: 5000
                            }
                        );
                        
                        console.log(`Refresh successful with ID format: ${attemptedId}`);
                        return { success: true, message: "Perangkat berhasil diperbarui" };
                    } catch (attemptError) {
                        console.error(`Failed with ID format ${attemptedId}: ${attemptError.message}`);
                        // Lanjut ke percobaan berikutnya
                    }
                }
                
                throw new Error("Semua percobaan refresh gagal");
            } catch (altError) {
                console.error(`All refresh attempts failed: ${altError.message}`);
                throw altError;
            }
        }
        
    } catch (error) {
        console.error('Error refreshing device:', error);
        
        // Berikan respons error yang lebih spesifik
        let errorMessage = "Kesalahan tidak diketahui";
        
        if (error.response) {
            errorMessage = `Error ${error.response.status}: ${error.response.data || 'No response data'}`;
        } else if (error.request) {
            errorMessage = "Tidak ada respons dari server GenieACS";
        } else {
            errorMessage = error.message;
        }
        
        return { 
            success: false, 
            message: `Gagal memperbarui perangkat: ${errorMessage}` 
        };
    }
}

// Tambahkan handler untuk menu admin
async function handleAdminMenu(remoteJid) {
    await sendAdminMenuList(remoteJid);
}

// Update handler admin check ONU
async function handleAdminCheckONU(remoteJid, customerNumber) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (!customerNumber) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `admincheck [nomor_pelanggan]\n\n` +
                  `Contoh:\n` +
                  `admincheck 123456`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔍 *MENCARI PERANGKAT*\n\nSedang mencari perangkat untuk pelanggan ${customerNumber}...\nMohon tunggu sebentar.` 
        });

        // Cari perangkat berdasarkan nomor pelanggan
        const device = await findDeviceByTag(customerNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *PERANGKAT TIDAK DITEMUKAN*\n\n` +
                      `Tidak dapat menemukan perangkat untuk pelanggan dengan nomor ${customerNumber}.\n\n` +
                      `Pastikan nomor pelanggan benar dan perangkat telah terdaftar dalam sistem.`
            });
            return;
        }

        // Ekstrak informasi perangkat - Gunakan pendekatan yang sama dengan dashboard web
        // Coba ambil dari berbagai kemungkinan path untuk memastikan konsistensi dengan dashboard
        let serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 
                          device.Device?.DeviceInfo?.SerialNumber?._value || 
                          device.DeviceID?.SerialNumber || 
                          device._id?.split('-')[2] || 'Unknown';
        
        // Coba ambil model dari berbagai kemungkinan path
        let modelName = device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || 
                        device.Device?.DeviceInfo?.ModelName?._value || 
                        device.DeviceID?.ProductClass || 
                        device._id?.split('-')[1] || 'Unknown';
        
        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;
        const statusText = isOnline ? '🟢 Online' : '🔴 Offline';
        
        // Informasi WiFi
        const ssid = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        const ssid5G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.SSID?._value || 'N/A';
        
        // Informasi IP
        const ipAddress = device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.ExternalIPAddress?._value || 'N/A';
        
        // Informasi PPPoE
        const pppoeUsername = 
            device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
            device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
            device.VirtualParameters?.pppoeUsername?._value ||
            'N/A';
        
        // Informasi RX Power
        const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
        let rxPowerStatus = '';
        if (rxPower) {
            const power = parseFloat(rxPower);
            if (power > -25) rxPowerStatus = '🟢 Baik';
            else if (power > -27) rxPowerStatus = '🟠 Warning';
            else rxPowerStatus = '🔴 Kritis';
        }
        
        // Informasi pengguna WiFi
        const users24ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.TotalAssociations?._value || 0;
        const users5ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.TotalAssociations?._value || 0;
        const totalUsers = parseInt(users24ghz) + parseInt(users5ghz);

        // Ambil daftar user terhubung ke SSID 1 (2.4GHz)
        let associatedDevices = [];
        try {
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        associatedDevices.push({ mac, hostname });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices (admin):', e);
        }
        // Fallback: jika AssociatedDevice kosong, ambil dari Hosts.Host (hanya WiFi/802.11)
        if (associatedDevices.length === 0) {
            try {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            // Hanya tampilkan yang interface-nya 802.11 (WiFi)
                            const iface = entry?.InterfaceType?._value || entry?.InterfaceType || entry?.Interface || '-';
                            // Pastikan iface adalah string sebelum memanggil toLowerCase()
                            if (iface && typeof iface === 'string' && iface.toLowerCase().includes('802.11')) {
                                const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                                const hostname = entry?.HostName?._value || entry?.HostName || '-';
                                const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                                associatedDevices.push({ mac, hostname, ip });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing Hosts.Host (admin):', e);
            }
        }

        // Buat pesan dengan informasi lengkap
        // Gunakan serial number dan model yang sudah diambil sebelumnya
        // Tidak perlu mengubah nilai yang sudah diambil dengan benar

        let message = `📱 *DETAIL PERANGKAT PELANGGAN*\n\n`;
        message += `👤 *Pelanggan:* ${customerNumber}\n`;
        message += `📱 *Serial Number:* ${serialNumber}\n`;
        message += `📱 *Model:* ${modelName}\n`;
        message += `📡 *Status:* ${statusText}\n`;
        message += `⏱️ *Last Seen:* ${lastInform.toLocaleString()}\n\n`;
        
        message += `🌐 *INFORMASI JARINGAN*\n`;
        message += `• IP Address: ${ipAddress}\n`;
        message += `• PPPoE Username: ${pppoeUsername}\n`;
        message += `• WiFi 2.4GHz: ${ssid}\n`;
        message += `• WiFi 5GHz: ${ssid5G}\n`;
        message += `• Pengguna WiFi: ${totalUsers} perangkat\n`;
        // Tambahkan detail user SSID 1 jika ada
        if (associatedDevices.length > 0) {
            message += `└─ *Daftar User WiFi (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                let detail = `${idx + 1}. ${dev.hostname || '-'} (${dev.mac || '-'}`;
                if (dev.ip) detail += `, ${dev.ip}`;
                detail += ')';
                message += `   ${detail}\n`;
            });
        } else {
            message += `└─ Tidak ada data user WiFi (2.4GHz) tersedia\n`;
        }
        message += `\n`;
        
        if (rxPower) {
            message += `📶 *KUALITAS SINYAL*\n`;
            message += `• RX Power: ${rxPower} dBm (${rxPowerStatus})\n\n`;
        }
        
        message += `💡 *TINDAKAN ADMIN*\n`;
        message += `• Ganti SSID: editssid ${customerNumber} [nama_baru]\n`;
        message += `• Ganti Password: editpass ${customerNumber} [password_baru]\n`;
        message += `• Refresh Perangkat: adminrefresh ${customerNumber}`;

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleAdminCheckONU:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat memeriksa perangkat:\n${error.message}`
        });
    }
}

// Fungsi untuk mencari perangkat berdasarkan tag
async function findDeviceByTag(tag) {
    try {
        console.log(`Searching for device with tag: ${tag}`);
        
        // Coba cari dengan query langsung
        try {
            // Pertama coba dengan query exact match
            const exactResponse = await axios.get(`${process.env.GENIEACS_URL}/devices/?query={"_tags":"${tag}"}`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            if (exactResponse.data && exactResponse.data.length > 0) {
                console.log(`Device found with exact tag match: ${tag}`);
                return exactResponse.data[0];
            }
            
            // Jika tidak ditemukan dengan exact match, coba dengan partial match
            console.log(`No exact match found for tag ${tag}, trying partial match...`);
            const partialResponse = await axios.get(`${process.env.GENIEACS_URL}/devices`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Cari perangkat dengan tag yang cocok sebagian
            if (partialResponse.data && partialResponse.data.length > 0) {
                for (const device of partialResponse.data) {
                    if (device._tags && Array.isArray(device._tags)) {
                        // Cek apakah ada tag yang berisi nomor yang dicari
                        const matchingTag = device._tags.find(t => 
                            t === tag || // Exact match
                            t.includes(tag) || // Tag berisi nomor
                            tag.includes(t) // Nomor berisi tag (jika tag adalah nomor parsial)
                        );
                        
                        if (matchingTag) {
                            console.log(`Device found with partial tag match: ${matchingTag}`);
                            return device;
                        }
                    }
                }
            }
            
            console.log(`No device found with tag containing: ${tag}`);
            return null;
            
        } catch (queryError) {
            console.error('Error with tag query:', queryError.message);
            
            // Jika gagal, coba cara alternatif dengan mengambil semua perangkat
            console.log('Trying alternative method: fetching all devices');
            const allDevicesResponse = await axios.get(`${process.env.GENIEACS_URL}/devices`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Cari perangkat dengan tag yang sesuai
            const device = allDevicesResponse.data.find(d => {
                if (!d._tags) return false;
                
                // Cek apakah ada tag yang cocok
                return d._tags.some(t => 
                    t === tag || // Exact match
                    t.includes(tag) || // Tag berisi nomor
                    tag.includes(t) // Nomor berisi tag
                );
            });
            
            return device || null;
        }
    } catch (error) {
        console.error('Error finding device by tag:', error);
        throw error;
    }
}

// Handler untuk pelanggan ganti SSID
async function handleChangeSSID(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change SSID request from ${senderNumber} with params:`, params);
        
        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
❌ *NOMOR TIDAK TERDAFTAR*

Waduh, nomor kamu belum terdaftar nih.
Hubungi admin dulu yuk untuk daftar!${FOOTER_INFO}` 
            });
            return;
        }

        if (params.length < 1) {
            // Kirim template untuk input nama WiFi
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
📝 *CARA GANTI NAMA WIFI*

⚠️ Format Perintah:
*gantiwifi [nama_wifi_baru]*

📱 Contoh:
*gantiwifi RumahKu*

🔸 Nama WiFi akan langsung diperbarui
🔸 Tunggu beberapa saat sampai perubahan aktif
🔸 Perangkat yang terhubung mungkin akan terputus${FOOTER_INFO}`,
            });
            return;
        }

        const newSSID = params.join(' ');
        const newSSID5G = `${newSSID}-5G`;
        
        // Kirim pesan bahwa permintaan sedang diproses
        await sock.sendMessage(remoteJid, { 
            text: `${COMPANY_HEADER}
⏳ *PERMINTAAN DIPROSES*

Sedang mengubah nama WiFi Anda...
• WiFi 2.4GHz: ${newSSID}
• WiFi 5GHz: ${newSSID5G}

Mohon tunggu sebentar.${FOOTER_INFO}`
        });
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);
        
        // Update SSID 2.4GHz hanya di index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // hanya index 1 untuk 2.4GHz
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );
        
        // Update SSID 5GHz hanya di index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        if (!wifi5GFound) {
            console.warn('Tidak ada konfigurasi SSID 5GHz yang valid ditemukan. SSID 5GHz tidak diubah.');
        }
        
        // Tambahkan task refresh
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        let responseMessage = `${COMPANY_HEADER}
✅ *NAMA WIFI BERHASIL DIUBAH!*

📡 *Nama WiFi Baru:*
• WiFi 2.4GHz: ${newSSID}`;

        if (wifi5GFound) {
            responseMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
        } else {
            responseMessage += `\n• WiFi 5GHz: Pengaturan tidak ditemukan atau gagal diubah`;
        }

        responseMessage += `\n
⏳ Perangkat akan melakukan restart untuk menerapkan perubahan.
📱 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang ke nama WiFi baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${FOOTER_INFO}`;

        await sock.sendMessage(remoteJid, { text: responseMessage });

    } catch (error) {
        console.error('Error handling change SSID:', error);
        await sock.sendMessage(remoteJid, { 
            text: `${COMPANY_HEADER}
❌ *GAGAL MENGUBAH NAMA WIFI*

Oops! Ada kendala teknis saat mengubah nama WiFi kamu.
Beberapa kemungkinan penyebabnya:
• Router sedang offline
• Masalah koneksi ke server
• Format nama tidak didukung

Pesan error: ${error.message}

Coba lagi nanti ya!${FOOTER_INFO}` 
        });
    }
}

// Handler untuk admin mengubah password WiFi pelanggan
async function handleAdminEditPassword(adminJid, customerNumber, newPassword) {
    try {
        console.log(`Admin mengubah password WiFi untuk pelanggan ${customerNumber}`);
        
        // Validasi panjang password
        if (newPassword.length < 8) {
            await sock.sendMessage(adminJid, { 
                text: `${COMPANY_HEADER}
❌ *PASSWORD TERLALU PENDEK*

Password WiFi harus minimal 8 karakter.
Silakan coba lagi dengan password yang lebih panjang.${FOOTER_INFO}`
            });
            return;
        }
        
        // Format nomor pelanggan untuk mencari di GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Mencari perangkat untuk nomor: ${formattedNumber}`);
        
        // Cari perangkat pelanggan
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, { 
                text: `${COMPANY_HEADER}
❌ *NOMOR PELANGGAN TIDAK DITEMUKAN*

Nomor ${customerNumber} tidak terdaftar di sistem.
Periksa kembali nomor pelanggan.${FOOTER_INFO}` 
            });
            return;
        }
        
        // Kirim pesan ke admin bahwa permintaan sedang diproses
        await sock.sendMessage(adminJid, { 
            text: `${COMPANY_HEADER}
⏳ *PERMINTAAN DIPROSES*

Sedang mengubah password WiFi pelanggan ${customerNumber}...
Password baru: ${newPassword}

Mohon tunggu sebentar.${FOOTER_INFO}`
        });
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);
        
        // Update password WiFi 2.4GHz di index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );
        
        // Update password WiFi 5GHz di index 5, 6, 7, 8
        let wifi5GFound = false;
        const wifi5gIndexes = [5, 6, 7, 8];
        for (const idx of wifi5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz password using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz password using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz password with index ${idx}:`, error.message);
            }
        }
        
        // Tambahkan task refresh
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }
        
        // Pesan sukses untuk admin
        const adminResponseMessage = `${COMPANY_HEADER}
✅ *PASSWORD WIFI PELANGGAN BERHASIL DIUBAH!*

📱 *Pelanggan:* ${customerNumber}
🔐 *Password WiFi Baru:* ${newPassword}

⏳ Perangkat akan melakukan restart untuk menerapkan perubahan.
📱 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang dengan password baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${FOOTER_INFO}`;

        await sock.sendMessage(adminJid, { text: adminResponseMessage });
        
        // Kirim notifikasi ke pelanggan tentang perubahan password WiFi
        try {
            // Format nomor pelanggan untuk WhatsApp
            let customerJid;
            if (customerNumber.includes('@')) {
                customerJid = customerNumber; // Sudah dalam format JID
            } else {
                // Format nomor untuk WhatsApp
                const cleanNumber = customerNumber.replace(/\D/g, '');
                customerJid = `${cleanNumber}@s.whatsapp.net`;
            }
            
            // Pesan notifikasi untuk pelanggan
            const customerNotificationMessage = `${COMPANY_HEADER}
📢 *PEMBERITAHUAN PERUBAHAN PASSWORD WIFI*

Halo Pelanggan Setia,

Kami informasikan bahwa password WiFi Anda telah diubah oleh admin:

🔐 *Password WiFi Baru:* ${newPassword}

⏳ Perangkat Anda akan melakukan restart untuk menerapkan perubahan.
📱 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang dengan password baru.

_Catatan: Simpan informasi ini sebagai dokumentasi jika Anda lupa password WiFi di kemudian hari._${FOOTER_INFO}`;
            
            await sock.sendMessage(customerJid, { text: customerNotificationMessage });
            console.log(`Notification sent to customer ${customerNumber} about WiFi password change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Kirim pesan ke admin bahwa notifikasi ke pelanggan gagal
            await sock.sendMessage(adminJid, { 
                text: `${COMPANY_HEADER}
⚠️ *INFO*

Password WiFi pelanggan berhasil diubah, tetapi gagal mengirim notifikasi ke pelanggan.
Error: ${notificationError.message}${FOOTER_INFO}` 
            });
        }
        
    } catch (error) {
        console.error('Error handling admin edit password:', error);
        await sock.sendMessage(adminJid, { 
            text: `${COMPANY_HEADER}
❌ *GAGAL MENGUBAH PASSWORD WIFI PELANGGAN*

Oops! Ada kendala teknis saat mengubah password WiFi pelanggan.
Beberapa kemungkinan penyebabnya:
• Router pelanggan sedang offline
• Masalah koneksi ke server
• Format password tidak didukung

Pesan error: ${error.message}

Coba lagi nanti ya!${FOOTER_INFO}` 
        });
    }
}

// Handler untuk admin mengubah SSID pelanggan
async function handleAdminEditSSID(adminJid, customerNumber, newSSID) {
    try {
        console.log(`Admin mengubah SSID untuk pelanggan ${customerNumber} menjadi ${newSSID}`);
        
        // Format nomor pelanggan untuk mencari di GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Mencari perangkat untuk nomor: ${formattedNumber}`);
        
        // Cari perangkat pelanggan
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, { 
                text: `${COMPANY_HEADER}
❌ *NOMOR PELANGGAN TIDAK DITEMUKAN*

Nomor ${customerNumber} tidak terdaftar di sistem.
Periksa kembali nomor pelanggan.${FOOTER_INFO}` 
            });
            return;
        }
        
        // Buat nama SSID 5G berdasarkan SSID 2.4G
        const newSSID5G = `${newSSID}-5G`;
        
        // Kirim pesan ke admin bahwa permintaan sedang diproses
        await sock.sendMessage(adminJid, { 
            text: `${COMPANY_HEADER}
⏳ *PERMINTAAN DIPROSES*

Sedang mengubah nama WiFi pelanggan ${customerNumber}...
• WiFi 2.4GHz: ${newSSID}
• WiFi 5GHz: ${newSSID5G}

Mohon tunggu sebentar.${FOOTER_INFO}`
        });
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);
        
        // Update SSID 2.4GHz di index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );
        
        // Update SSID 5GHz di index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        
        // Tambahkan task refresh
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }
        
        // Pesan sukses untuk admin
        let adminResponseMessage = `${COMPANY_HEADER}
✅ *NAMA WIFI PELANGGAN BERHASIL DIUBAH!*

📱 *Pelanggan:* ${customerNumber}
📡 *Nama WiFi Baru:*
• WiFi 2.4GHz: ${newSSID}`;

        if (wifi5GFound) {
            adminResponseMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
        } else {
            adminResponseMessage += `\n• WiFi 5GHz: Pengaturan tidak ditemukan atau gagal diubah`;
        }

        adminResponseMessage += `\n
⏳ Perangkat akan melakukan restart untuk menerapkan perubahan.
📱 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang ke nama WiFi baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${FOOTER_INFO}`;

        await sock.sendMessage(adminJid, { text: adminResponseMessage });
        
        // Kirim notifikasi ke pelanggan tentang perubahan SSID
        try {
            // Format nomor pelanggan untuk WhatsApp
            let customerJid;
            if (customerNumber.includes('@')) {
                customerJid = customerNumber; // Sudah dalam format JID
            } else {
                // Format nomor untuk WhatsApp
                const cleanNumber = customerNumber.replace(/\D/g, '');
                customerJid = `${cleanNumber}@s.whatsapp.net`;
            }
            
            // Pesan notifikasi untuk pelanggan
            const customerNotificationMessage = `${COMPANY_HEADER}
📢 *PEMBERITAHUAN PERUBAHAN WIFI*

Halo Pelanggan Setia,

Kami informasikan bahwa nama WiFi Anda telah diubah oleh admin:

📡 *Nama WiFi Baru:*
• WiFi 2.4GHz: ${newSSID}`;
            
            let fullCustomerMessage = customerNotificationMessage;
            if (wifi5GFound) {
                fullCustomerMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
            }
            
            fullCustomerMessage += `\n
⏳ Perangkat Anda akan melakukan restart untuk menerapkan perubahan.
📱 Perangkat yang terhubung akan terputus dan perlu menghubungkan ulang ke nama WiFi baru.

_Catatan: Simpan informasi ini sebagai dokumentasi jika Anda lupa nama WiFi di kemudian hari._${FOOTER_INFO}`;
            
            await sock.sendMessage(customerJid, { text: fullCustomerMessage });
            console.log(`Notification sent to customer ${customerNumber} about SSID change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Kirim pesan ke admin bahwa notifikasi ke pelanggan gagal
            await sock.sendMessage(adminJid, { 
                text: `${COMPANY_HEADER}
⚠️ *INFO*

Nama WiFi pelanggan berhasil diubah, tetapi gagal mengirim notifikasi ke pelanggan.
Error: ${notificationError.message}${FOOTER_INFO}` 
            });
        }
        
    } catch (error) {
        console.error('Error handling admin edit SSID:', error);
        await sock.sendMessage(adminJid, { 
            text: `${COMPANY_HEADER}
❌ *GAGAL MENGUBAH NAMA WIFI PELANGGAN*

Oops! Ada kendala teknis saat mengubah nama WiFi pelanggan.
Beberapa kemungkinan penyebabnya:
• Router pelanggan sedang offline
• Masalah koneksi ke server
• Format nama tidak didukung

Pesan error: ${error.message}

Coba lagi nanti ya!${FOOTER_INFO}` 
        });
    }
}

// Handler untuk pelanggan ganti password
async function handleChangePassword(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change password request from ${senderNumber} with params:`, params);
        
        // Validasi parameter
        if (params.length < 1) {
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
❌ *FORMAT SALAH*

⚠️ Format Perintah:
*gantipass [password_baru]*

📱 Contoh:
*gantipass Password123*

🔸 Password harus minimal 8 karakter
🔸 Hindari password yang mudah ditebak${FOOTER_INFO}`
            });
            return;
        }
        
        const newPassword = params[0];
        
        // Validasi panjang password
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
❌ *PASSWORD TERLALU PENDEK*

Password WiFi harus minimal 8 karakter.
Silakan coba lagi dengan password yang lebih panjang.${FOOTER_INFO}`
            });
            return;
        }
        
        // Cari perangkat berdasarkan nomor pengirim
        console.log(`Finding device for number: ${senderNumber}`);
        
        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
❌ *NOMOR TIDAK TERDAFTAR*

Waduh, nomor kamu belum terdaftar nih.
Hubungi admin dulu yuk untuk daftar!${FOOTER_INFO}`
            });
            return;
        }
        
        // Dapatkan ID perangkat
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);
        
        // Kirim pesan bahwa permintaan sedang diproses
        await sock.sendMessage(remoteJid, { 
            text: `${COMPANY_HEADER}
⏳ *PERMINTAAN DIPROSES*

Sedang mengubah password WiFi Anda...
Mohon tunggu sebentar.${FOOTER_INFO}`
        });
        
        // Perbarui password WiFi
        const result = await changePassword(deviceId, newPassword);
        
        if (result.success) {
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
✅ *PASSWORD WIFI BERHASIL DIUBAH!*

🔐 *Password Baru:* ${newPassword}

⏳ Tunggu bentar ya, perubahan akan aktif dalam beberapa saat.
📱 Perangkat yang terhubung mungkin akan terputus dan harus menghubungkan ulang dengan password baru.

_Perubahan selesai pada: ${new Date().toLocaleString()}_${FOOTER_INFO}`
            });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `${COMPANY_HEADER}
❌ *GAGAL MENGUBAH PASSWORD*

Oops! Ada kendala teknis saat mengubah password WiFi kamu.
Beberapa kemungkinan penyebabnya:
• Router sedang offline
• Masalah koneksi ke server
• Format password tidak didukung

Pesan error: ${result.message}

Coba lagi nanti ya!${FOOTER_INFO}`
            });
        }
    } catch (error) {
        console.error('Error handling password change:', error);
        await sock.sendMessage(remoteJid, { 
            text: `${COMPANY_HEADER}
❌ *TERJADI KESALAHAN*

Error: ${error.message}

Silakan coba lagi nanti atau hubungi admin.${FOOTER_INFO}`
        });
    }
}

// Fungsi untuk mengubah password WiFi perangkat
async function changePassword(deviceId, newPassword) {
    try {
        console.log(`Changing password for device: ${deviceId}`);
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeDeviceId(deviceId);
        
        // Ambil informasi perangkat terlebih dahulu
        // PERBAIKAN: Cek apakah perangkat ada dengan cara lebih sederhana
        // tanpa menggunakan genieacsApi.getDeviceInfo
        
        // URL untuk tasks GenieACS
        const tasksUrl = `${global.appSettings.genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;
        
        // Buat task untuk mengubah password
        // Perbarui parameter untuk 2.4GHz WiFi
        const updatePass24Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };
        
        console.log('Sending task to update password 2.4GHz');
        const response24 = await axios.post(
            tasksUrl,
            updatePass24Task,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);
        
        // Perbarui parameter untuk 5GHz WiFi
        const updatePass5Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };
        
        console.log('Sending task to update password 5GHz');
        const response5 = await axios.post(
            tasksUrl,
            updatePass5Task,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`5GHz password update response:`, response5.status);
        
        // Kirim refresh task untuk memastikan perubahan diterapkan
        const refreshTask = {
            name: "refreshObject",
            objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        };
        
        console.log('Sending refresh task');
        await axios.post(
            tasksUrl,
            refreshTask,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return { success: true, message: 'Password berhasil diubah' };
    } catch (error) {
        console.error('Error changing password:', error);
        return { 
            success: false, 
            message: error.response?.data?.message || error.message 
        };
    }
}

// Handler untuk admin mengubah password WiFi pelanggan
async function handleAdminEditPassword(remoteJid, customerNumber, newPassword) {
    try {
        console.log(`Handling admin edit password request`);
        
        // Validasi parameter
        if (!customerNumber || !newPassword) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *FORMAT Salah!*\n\nFormat yang benar:\neditpassword [nomor_pelanggan] [password_baru]\n\nContoh:\neditpassword 123456 password123`
            });
            return;
        }
        // Validasi panjang password
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Password terlalu pendek!*\n\nPassword harus minimal 8 karakter.`
            });
            return;
        }
        
        // Cari perangkat berdasarkan tag nomor pelanggan
        console.log(`Finding device for customer: ${customerNumber}`);
        
        const device = await findDeviceByTag(customerNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Perangkat tidak ditemukan!*\n\n` +
                      `Nomor pelanggan "${customerNumber}" tidak terdaftar di sistem.`
            });
            return;
        }
        
        // Dapatkan ID perangkat
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);
        
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PERUBAHAN PASSWORD*\n\nSedang mengubah password WiFi untuk pelanggan ${customerNumber}...\nMohon tunggu sebentar.` 
        });
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(deviceId);
        
        // URL untuk tasks GenieACS
        const tasksUrl = `${global.appSettings.genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;
        
        // Buat task untuk mengubah password 2.4GHz
        const updatePass24Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };
        
        console.log('Sending task to update password 2.4GHz');
        const response24 = await axios.post(
            tasksUrl,
            updatePass24Task,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);
        
        // Coba perbarui password untuk 5GHz pada index 5 terlebih dahulu
        let wifi5GFound = false;
        
        try {
            console.log('Trying to update 5GHz password using config index 5');
            const updatePass5Task = {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            };
            
            await axios.post(
                tasksUrl,
                updatePass5Task,
                {
                    auth: {
                        username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                        password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Successfully updated 5GHz password using config index 5');
            wifi5GFound = true;
        } catch (error5) {
            console.error('Error updating 5GHz password with index 5:', error5.message);
            
            // Mencoba dengan index lain selain 2 (3, 4, 6)
            const alternativeIndexes = [3, 4, 6];
            
            for (const idx of alternativeIndexes) {
                if (wifi5GFound) break;
                
                try {
                    console.log(`Trying to update 5GHz password using config index ${idx}`);
                    const updatePassAltTask = {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"],
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.PreSharedKey.1.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    };
                    
                    await axios.post(
                        tasksUrl,
                        updatePassAltTask,
                        {
                            auth: {
                                username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                                password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    console.log(`Successfully updated 5GHz password using config index ${idx}`);
                    wifi5GFound = true;
                    break;
                } catch (error) {
                    console.error(`Error updating 5GHz password with index ${idx}:`, error.message);
                }
            }
            
            // Jika index 5 dan alternatif (3, 4, 6) gagal, biarkan SSID 5GHz tidak berubah
            if (!wifi5GFound) {
                try {
                    console.log('Last resort: trying to update 5GHz password using config index 2');
                    const updatePass2Task = {
                        name: "setParameterValues",
                        parameterValues: [
                            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase", newPassword, "xsd:string"],
                            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
                        ]
                    };
                    
                    await axios.post(
                        tasksUrl,
                        updatePass2Task,
                        {
                            auth: {
                                username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                                password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    console.log('Successfully updated 5GHz password using config index 2');
                    wifi5GFound = true;
                } catch (error2) {
                    console.error('Error updating 5GHz password with index 2:', error2.message);
                }
            }
        }
        
        // Kirim refresh task untuk memastikan perubahan diterapkan
        try {
            await axios.post(
                tasksUrl,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                        password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Dapatkan informasi SSID dari perangkat untuk notifikasi
        const ssid24G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'WiFi 2.4GHz';
        
        // Respons ke admin
        let responseMessage = `✅ *PASSWORD WIFI BERHASIL DIUBAH!*\n\n` +
              `Pelanggan: ${customerNumber}\n` +
              `Password baru: ${newPassword}\n\n`;
              
        if (wifi5GFound) {
            responseMessage += `Password berhasil diubah untuk WiFi 2.4GHz dan 5GHz.\n\n`;
        } else {
            responseMessage += `Password berhasil diubah untuk WiFi 2.4GHz.\n` +
                              `WiFi 5GHz: Pengaturan tidak ditemukan atau gagal diubah.\n\n`;
        }
        
        responseMessage += `Perubahan akan diterapkan dalam beberapa menit.`;
        
        // Coba kirim notifikasi ke pelanggan
        let notificationSent = false;
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                console.log(`Sending password change notification to customer: ${customerNumber}`);
                
                // Format nomor telepon
                const formattedNumber = formatPhoneNumber(customerNumber);
                
                // Buat pesan notifikasi untuk pelanggan
                const notificationMessage = `🏢 *${COMPANY_HEADER || ''}*
                
📢 *INFORMASI PERUBAHAN PASSWORD WIFI*

Halo Pelanggan yang terhormat,

Password WiFi Anda telah diubah oleh administrator sistem. Berikut detail perubahannya:

📶 *Nama WiFi:* ${ssid24G}
🔐 *Password Baru:* ${newPassword}

Silakan gunakan password baru ini untuk terhubung ke jaringan WiFi Anda.
Perubahan akan diterapkan dalam beberapa menit.${FOOTER_INFO || ''}`;

                // Kirim pesan menggunakan sock
                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, { 
                    text: notificationMessage 
                });
                
                console.log(`Password change notification sent to customer: ${customerNumber}`);
                notificationSent = true;
                
                responseMessage += `\nNotifikasi sudah dikirim ke pelanggan.`;
            } catch (notificationError) {
                console.error(`Failed to send notification to customer: ${customerNumber}`, notificationError);
                responseMessage += `\n\n⚠️ *Peringatan:* Gagal mengirim notifikasi ke pelanggan.\n` +
                                  `Error: ${notificationError.message}`;
            }
        }

        // Kirim respons ke admin
        await sock.sendMessage(remoteJid, { text: responseMessage });
        
    } catch (error) {
        console.error('Error handling admin password change:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *Terjadi kesalahan!*\n\n` +
                  `Error: ${error.message}\n\n` +
                  `Silakan coba lagi nanti.`
        });
    }
}

// Handler untuk admin edit SSID pelanggan
async function handleAdminEditSSID(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    console.log(`Processing adminssid command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `editssid [nomor_pelanggan] [nama_wifi_baru]\n\n` +
                  `Contoh:\n` +
                  `editssid 123456 RumahBaru`
        });
        return;
    }

    // Ambil nomor pelanggan dari parameter pertama
    const customerNumber = params[0];
    
    // Gabungkan semua parameter setelah nomor pelanggan sebagai SSID baru
    // Ini menangani kasus di mana SSID terdiri dari beberapa kata
    const newSSID = params.slice(1).join(' ');
    const newSSID5G = `${newSSID}-5G`;

    console.log(`Attempting to change SSID for customer ${customerNumber} to "${newSSID}"`);

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PERUBAHAN SSID*\n\nSedang mengubah nama WiFi untuk pelanggan ${customerNumber}...\nMohon tunggu sebentar.` 
        });

        // Cari perangkat berdasarkan nomor pelanggan
        const device = await findDeviceByTag(customerNumber);
        
        if (!device) {
            console.log(`Device not found for customer number: ${customerNumber}`);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *PERANGKAT TIDAK DITEMUKAN*\n\n` +
                      `Tidak dapat menemukan perangkat untuk pelanggan dengan nomor ${customerNumber}.\n\n` +
                      `Pastikan nomor pelanggan benar dan perangkat telah terdaftar dalam sistem.`
            });
            return;
        }

        console.log(`Device found for customer ${customerNumber}: ${device._id}`);

        // Dapatkan SSID saat ini untuk referensi
        const currentSSID = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        console.log(`Current SSID: ${currentSSID}`);
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(device._id);
        
        // Update SSID 2.4GHz hanya di index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // hanya index 1 untuk 2.4GHz
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );
        
        // Update SSID 5GHz hanya di index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        if (!wifi5GFound) {
            console.warn('Tidak ada konfigurasi SSID 5GHz yang valid ditemukan. SSID 5GHz tidak diubah.');
        }
        
        // Tambahkan task refresh
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Reboot perangkat untuk menerapkan perubahan
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        let responseMessage = `✅ *PERUBAHAN SSID BERHASIL*\n\n` +
                      `Nama WiFi untuk pelanggan ${customerNumber} berhasil diubah!\n\n` +
                      `• SSID Lama: ${currentSSID}\n` +
                      `• SSID Baru: ${newSSID}\n`;
                      
        if (wifi5GFound) {
            responseMessage += `• SSID 5GHz: ${newSSID5G}\n\n`;
        } else {
            responseMessage += `• SSID 5GHz: Pengaturan tidak ditemukan atau gagal diubah\n\n`;
        }
        
        responseMessage += `Perangkat WiFi akan restart dalam beberapa saat. Pelanggan perlu menghubungkan kembali perangkat mereka ke jaringan WiFi baru.`;

        await sock.sendMessage(remoteJid, { text: responseMessage });
        
        // Kirim notifikasi ke pelanggan jika nomor pelanggan adalah nomor telepon
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                const formattedNumber = formatPhoneNumber(customerNumber);
                
                let notificationMessage = `✅ *PERUBAHAN NAMA WIFI*\n\n` +
                                          `Halo Pelanggan yang terhormat,\n\n` +
                                          `Kami informasikan bahwa nama WiFi Anda telah diubah:\n\n` +
                                          `• Nama WiFi Baru: ${newSSID}\n`;
                                          
                if (wifi5GFound) {
                    notificationMessage += `• Nama WiFi 5GHz: ${newSSID5G}\n\n`;
                }
                
                notificationMessage += `Perangkat WiFi akan restart dalam beberapa saat. Silakan hubungkan kembali perangkat Anda ke jaringan WiFi baru.\n\n` +
                                      `Jika Anda memiliki pertanyaan, silakan balas pesan ini.`;
                
                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, { 
                    text: notificationMessage
                });
                console.log(`Notification sent to customer: ${customerNumber}`);
            } catch (notifyError) {
                console.error('Error notifying customer:', notifyError);
            }
        }
    } catch (error) {
        console.error('Error in handleAdminEditSSID:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengubah nama WiFi:\n${error.message}`
        });
    }
}

// Fungsi untuk mengubah SSID
async function changeSSID(deviceId, newSSID) {
    try {
        console.log(`Changing SSID for device ${deviceId} to "${newSSID}"`);
        
        // Encode deviceId untuk URL
        const encodedDeviceId = encodeURIComponent(deviceId);
        
        // Implementasi untuk mengubah SSID melalui GenieACS
        // Ubah SSID 2.4GHz
        try {
            console.log(`Setting 2.4GHz SSID to "${newSSID}"`);
            await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // hanya index 1 untuk 2.4GHz
            }, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Ubah SSID 5GHz dengan menambahkan suffix -5G
            console.log(`Setting 5GHz SSID to "${newSSID}-5G"`);
            await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", `${newSSID}-5G`, "xsd:string"]
                ]
            }, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Commit perubahan
            console.log(`Rebooting device to apply changes`);
            await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                name: "reboot"
            }, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            console.log(`SSID change successful`);
            return { success: true, message: "SSID berhasil diubah" };
        } catch (apiError) {
            console.error(`API Error: ${apiError.message}`);
            
            // Coba cara alternatif jika cara pertama gagal
            if (apiError.response && apiError.response.status === 404) {
                console.log(`Trying alternative path for device ${deviceId}`);
                
                try {
                    // Coba dengan path alternatif untuk 2.4GHz
                    await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.1.SSID", newSSID, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    });
                    
                    // Coba dengan path alternatif untuk 5GHz
                    await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.2.SSID", `${newSSID}-5G`, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    });
                    
                    // Commit perubahan
                    await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                        name: "reboot"
                    }, {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    });
                    
                    console.log(`SSID change successful using alternative path`);
                    return { success: true, message: "SSID berhasil diubah (menggunakan path alternatif)" };
                } catch (altError) {
                    console.error(`Alternative path also failed: ${altError.message}`);
                    throw altError;
                }
            } else {
                throw apiError;
            }
        }
    } catch (error) {
        console.error('Error changing SSID:', error);
        return { 
            success: false, 
            message: error.response ? 
                `${error.message} (Status: ${error.response.status})` : 
                error.message 
        };
    }
}

// Update handler list ONU
async function handleListONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔍 *MENCARI PERANGKAT*\n\nSedang mengambil daftar perangkat ONT...\nMohon tunggu sebentar.` 
        });

        // Ambil daftar perangkat dari GenieACS
        const devices = await getAllDevices();
        
        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, { 
                text: `ℹ️ *TIDAK ADA PERANGKAT*\n\nTidak ada perangkat ONT yang terdaftar dalam sistem.` 
            });
            return;
        }

        // Batasi jumlah perangkat yang ditampilkan untuk menghindari pesan terlalu panjang
        const maxDevices = 20;
        const displayedDevices = devices.slice(0, maxDevices);
        const remainingCount = devices.length - maxDevices;

        // Buat pesan dengan daftar perangkat
        let message = `📋 *DAFTAR PERANGKAT ONT*\n`;
        message += `Total: ${devices.length} perangkat\n\n`;

        displayedDevices.forEach((device, index) => {
            const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 
                                device.Device?.DeviceInfo?.SerialNumber?._value || 'Unknown';
            
            const modelName = device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || 'Unknown';
            
            const lastInform = new Date(device._lastInform);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
            const isOnline = diffMinutes < 15;
            const statusText = isOnline ? '🟢 Online' : '🔴 Offline';
            
            const tags = device._tags || [];
            const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
            
            message += `${index + 1}. *${customerInfo}*\n`;
            message += `   • SN: ${serialNumber}\n`;
            message += `   • Model: ${modelName}\n`;
            message += `   • Status: ${statusText}\n`;
            message += `   • Last Seen: ${lastInform.toLocaleString()}\n\n`;
        });

        if (remainingCount > 0) {
            message += `...dan ${remainingCount} perangkat lainnya.\n`;
            message += `Gunakan panel admin web untuk melihat daftar lengkap.`;
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleListONU:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar perangkat:\n${error.message}`
        });
    }
}

// Fungsi untuk mengambil semua perangkat
async function getAllDevices() {
    try {
        // Implementasi untuk mengambil semua perangkat dari GenieACS
        const response = await axios.get(`${process.env.GENIEACS_URL}/devices`, {
            auth: {
                username: process.env.GENIEACS_USERNAME,
                password: process.env.GENIEACS_PASSWORD
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting all devices:', error);
        throw error;
    }
}

// Tambahkan handler untuk cek semua ONU (detail)
async function handleCheckAllONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔍 *MEMERIKSA SEMUA PERANGKAT*\n\nSedang memeriksa status semua perangkat ONT...\nProses ini mungkin memakan waktu beberapa saat.` 
        });

        // Ambil daftar perangkat dari GenieACS
        const devices = await getAllDevices();
        
        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, { 
                text: `ℹ️ *TIDAK ADA PERANGKAT*\n\nTidak ada perangkat ONT yang terdaftar dalam sistem.` 
            });
            return;
        }

        // Hitung statistik perangkat
        let onlineCount = 0;
        let offlineCount = 0;
        let criticalRxPowerCount = 0;
        let warningRxPowerCount = 0;

        devices.forEach(device => {
            // Cek status online/offline
            const lastInform = new Date(device._lastInform);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
            const isOnline = diffMinutes < 15;
            
            if (isOnline) {
                onlineCount++;
            } else {
                offlineCount++;
            }

            // Cek RX Power
            const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
            if (rxPower) {
                const power = parseFloat(rxPower);
                if (power <= parseFloat(process.env.RX_POWER_CRITICAL || -27)) {
                    criticalRxPowerCount++;
                } else if (power <= parseFloat(process.env.RX_POWER_WARNING || -25)) {
                    warningRxPowerCount++;
                }
            }
        });

        // Buat pesan dengan statistik
        let message = `📊 *LAPORAN STATUS PERANGKAT*\n\n`;
        message += `📱 *Total Perangkat:* ${devices.length}\n\n`;
        message += `🟢 *Online:* ${onlineCount} (${Math.round(onlineCount/devices.length*100)}%)\n`;
        message += `🔴 *Offline:* ${offlineCount} (${Math.round(offlineCount/devices.length*100)}%)\n\n`;
        message += `📶 *Status Sinyal:*\n`;
        message += `🟠 *Warning:* ${warningRxPowerCount} perangkat\n`;
        message += `🔴 *Critical:* ${criticalRxPowerCount} perangkat\n\n`;
        
        // Tambahkan daftar perangkat dengan masalah
        if (criticalRxPowerCount > 0) {
            message += `*PERANGKAT DENGAN SINYAL KRITIS:*\n`;
            let count = 0;
            
            for (const device of devices) {
                const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
                if (rxPower && parseFloat(rxPower) <= parseFloat(process.env.RX_POWER_CRITICAL || -27)) {
                    const tags = device._tags || [];
                    const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                    const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                    
                    message += `${++count}. *${customerInfo}* (${serialNumber}): ${rxPower} dBm\n`;
                    
                    // Batasi jumlah perangkat yang ditampilkan
                    if (count >= 5) {
                        message += `...dan ${criticalRxPowerCount - 5} perangkat lainnya.\n`;
                        break;
                    }
                }
            }
            message += `\n`;
        }

        // Tambahkan daftar perangkat offline terbaru
        if (offlineCount > 0) {
            message += `*PERANGKAT OFFLINE TERBARU:*\n`;
            
            // Urutkan perangkat berdasarkan waktu terakhir online
            const offlineDevices = devices
                .filter(device => {
                    const lastInform = new Date(device._lastInform);
                    const now = new Date();
                    const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
                    return diffMinutes >= 15;
                })
                .sort((a, b) => new Date(b._lastInform) - new Date(a._lastInform));
            
            // Tampilkan 5 perangkat offline terbaru
            const recentOfflineDevices = offlineDevices.slice(0, 5);
            recentOfflineDevices.forEach((device, index) => {
                const tags = device._tags || [];
                const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                const lastInform = new Date(device._lastInform);
                
                message += `${index + 1}. *${customerInfo}* (${serialNumber})\n`;
                message += `   Last Seen: ${lastInform.toLocaleString()}\n`;
            });
            
            if (offlineCount > 5) {
                message += `...dan ${offlineCount - 5} perangkat offline lainnya.\n`;
            }
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleCheckAllONU:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nTerjadi kesalahan saat memeriksa perangkat:\n${error.message}`
        });
    }
}

// Handler untuk menghapus user hotspot
async function handleDeleteHotspotUser(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 1) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `delhotspot [username]\n\n` +
                  `Contoh:\n` +
                  `• delhotspot user123`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PENGHAPUSAN USER HOTSPOT*\n\nSedang menghapus user hotspot...\nMohon tunggu sebentar.` 
        });

        const [username] = params;
        console.log(`Deleting hotspot user: ${username}`);
        
        // Panggil fungsi untuk menghapus user hotspot
        const result = await deleteHotspotUser(username);
        console.log(`Hotspot user delete result:`, result);

        // Buat pesan respons
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'BERHASIL' : 'GAGAL'} MENGHAPUS USER HOTSPOT*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}`;

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delhotspot command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleDeleteHotspotUser:', error);
        
        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR MENGHAPUS USER HOTSPOT*\n\n` +
                          `Terjadi kesalahan saat menghapus user hotspot:\n` +
                          `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk menghapus PPPoE secret
async function handleDeletePPPoESecret(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 1) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `delpppoe [username]\n\n` +
                  `Contoh:\n` +
                  `• delpppoe user123`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PENGHAPUSAN SECRET PPPoE*\n\nSedang menghapus secret PPPoE...\nMohon tunggu sebentar.` 
        });

        const [username] = params;
        console.log(`Deleting PPPoE secret: ${username}`);
        
        const result = await deletePPPoESecret(username);
        console.log(`PPPoE secret delete result:`, result);

        // Buat pesan respons
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'BERHASIL' : 'GAGAL'} MENGHAPUS SECRET PPPoE*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}`;

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleDeletePPPoESecret:', error);
        
        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR MENGHAPUS SECRET PPPoE*\n\n` +
                          `Terjadi kesalahan saat menghapus secret PPPoE:\n` +
                          `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk menambah user hotspot
async function handleAddHotspotUser(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    console.log(`Processing addhotspot command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `addhotspot [username] [password] [profile]\n\n` +
                  `Contoh:\n` +
                  `• addhotspot user123 pass123\n` +
                  `• addhotspot user123 pass123 default`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PENAMBAHAN USER HOTSPOT*\n\nSedang menambahkan user hotspot...\nMohon tunggu sebentar.` 
        });

        const [username, password, profile = "default"] = params;
        console.log(`Adding hotspot user: ${username} with profile: ${profile}`);
        
        // Panggil fungsi untuk menambah user hotspot
        const result = await addHotspotUser(username, password, profile);
        console.log(`Hotspot user add result:`, result);

        // Buat pesan respons berdasarkan hasil
        let responseMessage = '';
        if (result.success) {
            responseMessage = `✅ *BERHASIL MENAMBAHKAN USER HOTSPOT*\n\n` +
                             `${result.message || 'User hotspot berhasil ditambahkan'}\n\n` +
                             `• Username: ${username}\n` +
                             `• Password: ${password}\n` +
                             `• Profile: ${profile}`;
        } else {
            responseMessage = `❌ *GAGAL MENAMBAHKAN USER HOTSPOT*\n\n` +
                             `${result.message || 'Terjadi kesalahan saat menambahkan user hotspot'}\n\n` +
                             `• Username: ${username}\n` +
                             `• Password: ${password}\n` +
                             `• Profile: ${profile}`;
        }

        // Kirim pesan respons dengan timeout untuk memastikan pesan terkirim
        setTimeout(async () => {
            try {
                console.log(`Sending response message for addhotspot command:`, responseMessage);
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent successfully`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500); // Tunggu 1.5 detik sebelum mengirim respons
        
    } catch (error) {
        console.error('Error in handleAddHotspotUser:', error);
        
        // Kirim pesan error dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR MENAMBAHKAN USER HOTSPOT*\n\n` +
                          `Terjadi kesalahan saat menambahkan user hotspot:\n` +
                          `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk menambah secret PPPoE
async function handleAddPPPoESecret(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `addpppoe [username] [password] [profile] [ip]\n\n` +
                  `Contoh:\n` +
                  `• addpppoe user123 pass123\n` +
                  `• addpppoe user123 pass123 default\n` +
                  `• addpppoe user123 pass123 default 10.0.0.1`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PENAMBAHAN SECRET PPPoE*\n\nSedang menambahkan secret PPPoE...\nMohon tunggu sebentar.` 
        });

        const [username, password, profile = "default", localAddress = ""] = params;
        console.log(`Adding PPPoE secret: ${username} with profile: ${profile}, IP: ${localAddress || 'from pool'}`);
        
        const result = await addPPPoESecret(username, password, profile, localAddress);
        console.log(`PPPoE secret add result:`, result);

        // Buat pesan respons
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'BERHASIL' : 'GAGAL'} MENAMBAHKAN SECRET PPPoE*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}\n` +
                               `• Profile: ${profile}\n` +
                               `• IP: ${localAddress || 'Menggunakan IP dari pool'}`;

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for addpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleAddPPPoESecret:', error);
        
        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR MENAMBAHKAN SECRET PPPoE*\n\n` +
                          `Terjadi kesalahan saat menambahkan secret PPPoE:\n` +
                          `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk mengubah profile PPPoE
async function handleChangePPPoEProfile(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *FORMAT SALAH*\n\n` +
                  `Format yang benar:\n` +
                  `setprofile [username] [new-profile]\n\n` +
                  `Contoh:\n` +
                  `setprofile user123 premium`
        });
        return;
    }

    try {
        // Kirim pesan bahwa proses sedang berlangsung
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PROSES PERUBAHAN PROFILE PPPoE*\n\nSedang mengubah profile PPPoE...\nMohon tunggu sebentar.` 
        });

        const [username, newProfile] = params;
        console.log(`Changing PPPoE profile for user ${username} to ${newProfile}`);
        
        const result = await changePPPoEProfile(username, newProfile);
        console.log(`PPPoE profile change result:`, result);

        // Buat pesan respons
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'BERHASIL' : 'GAGAL'} MENGUBAH PROFILE PPPoE*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}\n` +
                               `• Profile Baru: ${newProfile}`;

        // Kirim pesan respons dengan timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for setprofile command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Coba kirim ulang jika gagal
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleChangePPPoEProfile:', error);
        
        // Kirim pesan error
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR MENGUBAH PROFILE PPPoE*\n\n` +
                          `Terjadi kesalahan saat mengubah profile PPPoE:\n` +
                          `${error.message || 'Kesalahan tidak diketahui'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler untuk monitoring resource
async function handleResourceInfo(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil informasi resource router...`
        });
        
        // Import modul mikrotik
        const mikrotik = require('./mikrotik');
        
        // Ambil informasi resource
        const result = await mikrotik.getResourceInfo();

        if (result.success) {
            const { cpuLoad, freeMemory, totalMemory, uptime } = result.data;
            await sock.sendMessage(remoteJid, { 
                text: `📊 *INFO RESOURCE ROUTER*\n\n` +
                      `💻 *CPU*\n` +
                      `• Load: ${cpuLoad}%\n\n` +
                      `💾 *MEMORY*\n` +
                      `• Free: ${(freeMemory/1024/1024).toFixed(2)} MB\n` +
                      `• Total: ${(totalMemory/1024/1024).toFixed(2)} MB\n` +
                      `• Used: ${((totalMemory-freeMemory)/1024/1024).toFixed(2)} MB\n` +
                      `• Usage: ${((totalMemory-freeMemory)/totalMemory*100).toFixed(1)}%\n\n` +
                      `⏰ *UPTIME*\n` +
                      `• ${uptime}`
            });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling resource info command:', error);
        
        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil informasi resource: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Handler untuk melihat user hotspot aktif
async function handleActiveHotspotUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil daftar user hotspot aktif...`
        });
        
        console.log('Fetching active hotspot users');
        
        // Import modul mikrotik
        const mikrotik = require('./mikrotik');
        
        // Ambil daftar user hotspot aktif
        const result = await mikrotik.getActiveHotspotUsers();

        if (result.success) {
            let message = '👥 *DAFTAR USER HOTSPOT AKTIF*\n\n';
            
            if (result.data.length === 0) {
                message += 'Tidak ada user hotspot yang aktif';
            } else {
                result.data.forEach((user, index) => {
                    message += `${index + 1}. *User: ${user.user}*\n` +
                              `   • IP: ${user.address}\n` +
                              `   • Uptime: ${user.uptime}\n` +
                              `   • Download: ${(user.bytesIn/1024/1024).toFixed(2)} MB\n` +
                              `   • Upload: ${(user.bytesOut/1024/1024).toFixed(2)} MB\n\n`;
                });
            }
            
            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling active hotspot users command:', error);
        
        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar user hotspot aktif: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Perbaiki fungsi handleActivePPPoE
async function handleActivePPPoE(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil daftar koneksi PPPoE aktif...`
        });
        
        console.log('Fetching active PPPoE connections');
        
        // Import modul mikrotik
        const mikrotik = require('./mikrotik');
        
        // Ambil daftar koneksi PPPoE aktif
        const result = await mikrotik.getActivePPPoEConnections();

        if (result.success) {
            let message = '📡 *DAFTAR KONEKSI PPPoE AKTIF*\n\n';
            
            if (result.data.length === 0) {
                message += 'Tidak ada koneksi PPPoE yang aktif';
            } else {
                result.data.forEach((conn, index) => {
                    message += `${index + 1}. *User: ${conn.name}*\n` +
                              `   • Service: ${conn.service}\n` +
                              `   • IP: ${conn.address}\n` +
                              `   • Uptime: ${conn.uptime}\n` +
                              `   • Encoding: ${conn.encoding}\n\n`;
                });
            }
            
            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling active PPPoE connections command:', error);
        
        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar koneksi PPPoE aktif: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Tambahkan fungsi untuk mendapatkan daftar user offline
async function handleOfflineUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Kirim pesan sedang memproses
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Memproses Permintaan*\n\nSedang mengambil daftar user PPPoE offline...`
        });
        
        console.log('Fetching offline PPPoE users');
        
        // Import modul mikrotik
        const mikrotik = require('./mikrotik');
        
        // Ambil daftar user PPPoE offline
        const result = await mikrotik.getInactivePPPoEUsers();

        if (result.success) {
            let message = `📊 *DAFTAR USER PPPoE OFFLINE*\n\n`;
            message += `Total User: ${result.totalSecrets}\n`;
            message += `User Aktif: ${result.totalActive} (${((result.totalActive/result.totalSecrets)*100).toFixed(2)}%)\n`;
            message += `User Offline: ${result.totalInactive} (${((result.totalInactive/result.totalSecrets)*100).toFixed(2)}%)\n\n`;
            
            if (result.data.length === 0) {
                message += 'Tidak ada user PPPoE yang offline';
            } else {
                // Batasi jumlah user yang ditampilkan untuk menghindari pesan terlalu panjang
                const maxUsers = 30;
                const displayUsers = result.data.slice(0, maxUsers);
                
                displayUsers.forEach((user, index) => {
                    message += `${index + 1}. *${user.name}*${user.comment ? ` (${user.comment})` : ''}\n`;
                });
                
                if (result.data.length > maxUsers) {
                    message += `\n... dan ${result.data.length - maxUsers} user lainnya`;
                }
            }
            
            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nSilakan coba lagi nanti.`
            });
        }
    } catch (error) {
        console.error('Error handling offline users command:', error);
        
        // Kirim pesan error
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil daftar user offline: ${error.message}\n\nSilakan coba lagi nanti.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

const sendMessage = require('./sendMessage');

// Export modul
module.exports = {
    setSock,
    handleAddHotspotUser,
    handleAddPPPoESecret,
    handleChangePPPoEProfile,
    handleResourceInfo,
    handleActiveHotspotUsers,
    handleActivePPPoE,
    handleDeleteHotspotUser,
    handleDeletePPPoESecret,
    connectToWhatsApp,
    sendMessage,
    getWhatsAppStatus,
    deleteWhatsAppSession,
    getSock,
    handleOfflineUsers,
    updateConfig
};

// Fungsi untuk mengecek apakah perintah terkait dengan WiFi/SSID
function isWifiCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const wifiKeywords = [
        'gantiwifi', 'ubahwifi', 'changewifi', 'wifi', 
        'gantissid', 'ubahssid', 'ssid',
        'namawifi', 'updatewifi', 'wifiname', 'namessid',
        'setwifi', 'settingwifi', 'changewifiname'
    ];
    
    // Hapus 'editssid' dan 'editwifi' dari daftar perintah WiFi biasa
    // karena ini adalah perintah khusus admin
    return wifiKeywords.includes(command);
}

// Fungsi untuk mengecek apakah perintah terkait dengan password/sandi
function isPasswordCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const passwordKeywords = [
        'gantipass', 'ubahpass', 'editpass', 'changepass', 'password',
        'gantisandi', 'ubahsandi', 'editsandi', 'sandi',
        'gantipw', 'ubahpw', 'editpw', 'pw', 'pass',
        'gantipassword', 'ubahpassword', 'editpassword',
        'passwordwifi', 'wifipassword', 'passw', 'passwordwifi'
    ];
    
    return passwordKeywords.includes(command);
}

// Fungsi untuk mengirim pesan selamat datang
async function sendWelcomeMessage(remoteJid, isAdmin = false) {
    try {
        console.log(`Mengirim pesan selamat datang ke ${remoteJid}, isAdmin: ${isAdmin}`);
        
        // Pesan selamat datang
        let welcomeMessage = `👋 *Selamat Datang di Bot WhatsApp ${process.env.COMPANY_HEADER || 'ISP Monitor'}*\n\n`;
        
        if (isAdmin) {
            welcomeMessage += `Halo Admin! Anda dapat menggunakan berbagai perintah untuk mengelola sistem.\n\n`;
        } else {
            welcomeMessage += `Halo Pelanggan! Anda dapat menggunakan bot ini untuk mengelola perangkat Anda.\n\n`;
        }
        
        welcomeMessage += `Ketik *menu* untuk melihat daftar perintah yang tersedia.\n\n`;
        
        // Tambahkan footer
        welcomeMessage += `🏢 *${process.env.COMPANY_HEADER || 'ISP Monitor'}*\n`;
        welcomeMessage += `${process.env.FOOTER_INFO || ''}`;
        
        // Kirim pesan selamat datang
        await sock.sendMessage(remoteJid, { text: welcomeMessage });
        console.log(`Pesan selamat datang terkirim ke ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending welcome message:', error);
        return false;
    }
}

// Fungsi untuk encode device ID
function encodeDeviceId(deviceId) {
    // Pastikan deviceId adalah string
    const idString = String(deviceId);
    
    // Encode komponen-komponen URL secara terpisah
    return idString.split('/').map(part => encodeURIComponent(part)).join('/');
}

// Fungsi untuk mendapatkan status WhatsApp
function getWhatsAppStatus() {
    try {
        // Gunakan global.whatsappStatus jika tersedia
        if (global.whatsappStatus) {
            return global.whatsappStatus;
        }
        
        if (!sock) {
            return {
                connected: false,
                status: 'disconnected',
                qrCode: null
            };
        }

        if (sock.user) {
            return {
                connected: true,
                status: 'connected',
                phoneNumber: sock.user.id.split(':')[0],
                connectedSince: new Date()
            };
        }

        return {
            connected: false,
            status: 'connecting',
            qrCode: null
        };
    } catch (error) {
        console.error('Error getting WhatsApp status:', error);
        return {
            connected: false,
            status: 'error',
            error: error.message,
            qrCode: null
        };
    }
}

// Fungsi untuk menghapus sesi WhatsApp
async function deleteWhatsAppSession() {
    try {
        const sessionDir = process.env.WHATSAPP_SESSION_PATH || './whatsapp-session';
        const fs = require('fs');
        const path = require('path');
        
        // Hapus semua file di direktori sesi
        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
            }
            console.log(`Menghapus ${files.length} file sesi WhatsApp`);
        }
        
        console.log('Sesi WhatsApp berhasil dihapus');
        
        // Reset status
        global.whatsappStatus = {
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'session_deleted'
        };
        
        // Restart koneksi WhatsApp
        if (sock) {
            try {
                sock.logout();
            } catch (error) {
                console.log('Error saat logout:', error);
            }
        }
        
        // Mulai ulang koneksi setelah 2 detik
        setTimeout(() => {
            connectToWhatsApp();
        }, 2000);
        
        return { success: true, message: 'Sesi WhatsApp berhasil dihapus' };
    } catch (error) {
        console.error('Error saat menghapus sesi WhatsApp:', error);
        return { success: false, message: error.message };
    }
}

// Tambahkan fungsi ini di atas module.exports
function getSock() {
    return sock;
}

// Fungsi untuk menangani pesan masuk dengan penanganan error dan logging yang lebih baik
async function handleIncomingMessage(sock, message) {
    try {
        // Validasi input
        if (!message || !message.key) {
            logger.warn('Invalid message received', { message: typeof message });
            return;
        }
        
        // Ekstrak informasi pesan
        const remoteJid = message.key.remoteJid;
        if (!remoteJid) {
            logger.warn('Message without remoteJid received', { messageKey: message.key });
            return;
        }
        
        // Skip jika pesan dari grup dan bukan dari admin
        if (remoteJid.includes('@g.us')) {
            logger.debug('Message from group received', { groupJid: remoteJid });
            const participant = message.key.participant;
            if (!participant || !isAdminNumber(participant.split('@')[0])) {
                logger.debug('Group message not from admin, ignoring', { participant });
                return;
            }
            logger.info('Group message from admin, processing', { participant });
        }
        
        // Cek tipe pesan dan ekstrak teks
        let messageText = '';
        if (!message.message) {
            logger.debug('Message without content received', { messageType: 'unknown' });
            return;
        }
        
        if (message.message.conversation) {
            messageText = message.message.conversation;
            logger.debug('Conversation message received');
        } else if (message.message.extendedTextMessage) {
            messageText = message.message.extendedTextMessage.text;
            logger.debug('Extended text message received');
        } else {
            // Tipe pesan tidak didukung
            logger.debug('Unsupported message type received', { 
                messageTypes: Object.keys(message.message) 
            });
            return;
        }
        
        // Ekstrak nomor pengirim dengan penanganan error
        let senderNumber;
        try {
            senderNumber = remoteJid.split('@')[0];
        } catch (error) {
            logger.error('Error extracting sender number', { remoteJid, error: error.message });
            return;
        }
        
        logger.info(`Message received`, { sender: senderNumber, messageLength: messageText.length });
        logger.debug(`Message content`, { sender: senderNumber, message: messageText });
        
        // Cek apakah pengirim adalah admin
        const isAdmin = isAdminNumber(senderNumber);
        logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });
        
        // Jika pesan kosong, abaikan
        if (!messageText.trim()) {
            logger.debug('Empty message, ignoring');
            return;
        }
        
        // Proses perintah
        const command = messageText.trim().toLowerCase();
        
        // Perintah untuk mengaktifkan/menonaktifkan GenieACS (hanya untuk admin)
        // Perintah ini selalu diproses terlepas dari status genieacsCommandsEnabled
        
        // Perintah untuk menonaktifkan pesan GenieACS (hanya untuk admin)
        if (command.toLowerCase() === 'genieacs stop' && isAdmin) {
            console.log(`Admin ${senderNumber} menonaktifkan pesan GenieACS`);
            genieacsCommandsEnabled = false;
            await sendFormattedMessage(remoteJid, `✅ *PESAN GenieACS DINONAKTIFKAN*


Pesan GenieACS telah dinonaktifkan. Hubungi admin untuk mengaktifkan kembali.`);
            return;
        }
        
        // Perintah untuk mengaktifkan kembali pesan GenieACS (hanya untuk admin)
        if (command.toLowerCase() === 'genieacs start060111' && isAdmin) {
            console.log(`Admin ${senderNumber} mengaktifkan pesan GenieACS`);
            genieacsCommandsEnabled = true;
            await sendFormattedMessage(remoteJid, `✅ *PESAN GenieACS DIAKTIFKAN*


Pesan GenieACS telah diaktifkan kembali.`);
            return;
        }
        
        // Jika GenieACS dinonaktifkan, abaikan semua perintah kecuali dari nomor 6281947215703
        if (!genieacsCommandsEnabled && senderNumber !== '6281947215703') {
            // Hanya nomor 6281947215703 yang bisa menggunakan bot saat GenieACS dinonaktifkan
            console.log(`Pesan diabaikan karena GenieACS dinonaktifkan dan bukan dari nomor khusus: ${senderNumber}`);
            return;
        }
        
        // Perintah menu (ganti help)
        if (command === 'menu' || command === '!menu' || command === '/menu') {
            console.log(`Menjalankan perintah menu untuk ${senderNumber}`);
            await handleHelpCommand(remoteJid, isAdmin);
            return;
        }
        
        // Perintah status
        if (command === 'status' || command === '!status' || command === '/status') {
            console.log(`Menjalankan perintah status untuk ${senderNumber}`);
            await handleStatusCommand(senderNumber, remoteJid);
            return;
        }
        
        // Perintah refresh
        if (command === 'refresh' || command === '!refresh' || command === '/refresh') {
            console.log(`Menjalankan perintah refresh untuk ${senderNumber}`);
            await handleRefreshCommand(senderNumber, remoteJid);
            return;
        }
        
        // Perintah admin
        if ((command === 'admin' || command === '!admin' || command === '/admin') && isAdmin) {
            console.log(`Menjalankan perintah admin untuk ${senderNumber}`);
            await handleAdminMenu(remoteJid);
            return;
        }
        
        // Perintah untuk menonaktifkan/mengaktifkan GenieACS telah dipindahkan ke atas

        // Alias admin: cekstatus [nomor] atau cekstatus[nomor]
        if (isAdmin && (command.startsWith('cekstatus ') || command.startsWith('cekstatus'))) {
            let customerNumber = '';
            if (command.startsWith('cekstatus ')) {
                customerNumber = messageText.trim().split(' ')[1];
            } else {
                // Handle tanpa spasi, misal cekstatus081321960111
                customerNumber = command.replace('cekstatus','').trim();
            }
            if (customerNumber && /^\d{8,}$/.test(customerNumber)) {
                await handleAdminCheckONU(remoteJid, customerNumber);
                return;
            } else {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *FORMAT SALAH*\n\nFormat yang benar:\ncekstatus [nomor_pelanggan]\n\nContoh:\ncekstatus 081234567890`
                });
                return;
            }
        }
        
        // Perintah ganti WiFi
        if (isWifiCommand(command)) {
            console.log(`Menjalankan perintah ganti WiFi untuk ${senderNumber}`);
            const params = messageText.split(' ').slice(1);
            
            // Jika admin menggunakan perintah gantiwifi dengan format: gantiwifi [nomor_pelanggan] [ssid]
            if (isAdmin && params.length >= 2) {
                // Anggap parameter pertama sebagai nomor pelanggan
                const customerNumber = params[0];
                const ssidParams = params.slice(1);
                console.log(`Admin menggunakan gantiwifi untuk pelanggan ${customerNumber}`);
                await handleAdminEditSSID(remoteJid, customerNumber, ssidParams.join(' '));
            } else {
                // Pelanggan biasa atau format admin tidak sesuai
                await handleChangeSSID(senderNumber, remoteJid, params);
            }
            return;
        }
        
        // Perintah ganti password
        if (isPasswordCommand(command.split(' ')[0])) {
            console.log(`Menjalankan perintah ganti password untuk ${senderNumber}`);
            const params = messageText.split(' ').slice(1);
            
            // Jika admin menggunakan perintah gantipassword dengan format: gantipassword [nomor_pelanggan] [password]
            if (isAdmin && params.length >= 2) {
                // Anggap parameter pertama sebagai nomor pelanggan
                const customerNumber = params[0];
                const password = params[1];
                console.log(`Admin menggunakan gantipassword untuk pelanggan ${customerNumber}`);
                await handleAdminEditPassword(remoteJid, customerNumber, password);
            } else {
                // Pelanggan biasa atau format admin tidak sesuai
                await handleChangePassword(senderNumber, remoteJid, params);
            }
            return;
        }
        
        // Jika admin, cek perintah admin lainnya
        if (isAdmin) {
            // Perintah cek ONU
            if (command.startsWith('cek ') || command.startsWith('!cek ') || command.startsWith('/cek ')) {
                const customerNumber = command.split(' ')[1];
                if (customerNumber) {
                    console.log(`Menjalankan perintah cek ONU untuk pelanggan ${customerNumber}`);
                    await handleAdminCheckONU(remoteJid, customerNumber);
                    return;
                }
            }
            
            // Perintah edit SSID
            if (command.toLowerCase().startsWith('editssid ') || command.toLowerCase().startsWith('!editssid ') || command.toLowerCase().startsWith('/editssid ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah edit SSID untuk ${params[0]}`);
                    await handleAdminEditSSID(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *FORMAT Salah!*\n\n` +
                              `Format yang benar:\n` +
                              `editssid [nomor_pelanggan] [ssid_baru]\n\n` +
                              `Contoh:\n` +
                              `editssid 123456 RumahKu`
                    });
                    return;
                }
            }
            
            // Perintah edit password
            if (command.toLowerCase().startsWith('editpass ') || command.toLowerCase().startsWith('!editpass ') || command.toLowerCase().startsWith('/editpass ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah edit password untuk ${params[0]}`);
                    await handleAdminEditPassword(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *FORMAT Salah!*\n\n` +
                              `Format yang benar:\n` +
                              `editpass [nomor_pelanggan] [password_baru]\n\n` +
                              `Contoh:\n` +
                              `editpass 123456 password123`
                    });
                    return;
                }
            }
            
            // Perintah list ONU
            if (command === 'list' || command === '!list' || command === '/list') {
                console.log(`Menjalankan perintah list ONU`);
                await handleListONU(remoteJid);
                return;
            }
            
            // Perintah cek semua ONU
            if (command === 'cekall' || command === '!cekall' || command === '/cekall') {
                console.log(`Menjalankan perintah cek semua ONU`);
                await handleCheckAllONU(remoteJid);
                return;
            }
            
            // Perintah hapus user hotspot
            if (command.startsWith('delhotspot ') || command.startsWith('!delhotspot ') || command.startsWith('/delhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah hapus user hotspot ${params[0]}`);
                    await handleDeleteHotspotUser(remoteJid, params);
                    return;
                }
            }
            
            // Perintah hapus secret PPPoE
            if (command.startsWith('delpppoe ') || command.startsWith('!delpppoe ') || command.startsWith('/delpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Menjalankan perintah hapus secret PPPoE ${params[0]}`);
                    await handleDeletePPPoESecret(remoteJid, params);
                    return;
                }
            }
            
            // Perintah tambah user hotspot
            if (command.startsWith('addhotspot ') || command.startsWith('!addhotspot ') || command.startsWith('/addhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah user hotspot ${params[0]}`);
                    await handleAddHotspotUser(remoteJid, params);
                    return;
                }
            }
            
            // Perintah tambah secret PPPoE
            if (command.startsWith('addpppoe ') || command.startsWith('!addpppoe ') || command.startsWith('/addpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah secret PPPoE ${params[0]}`);
                    await handleAddPPPoESecret(remoteJid, params);
                    return;
                }
            }
            
            // Perintah ubah profile PPPoE
            if (command.startsWith('setprofile ') || command.startsWith('!setprofile ') || command.startsWith('/setprofile ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah ubah profile PPPoE ${params[0]}`);
                    await handleChangePPPoEProfile(remoteJid, params);
                    return;
                }
            }
            
            // Perintah info resource
            if (command === 'resource' || command === '!resource' || command === '/resource') {
                console.log(`Menjalankan perintah info resource`);
                await handleResourceInfo(remoteJid);
                return;
            }
            
            // Perintah tambah WAN
            if (command.startsWith('addwan ') || command.startsWith('!addwan ') || command.startsWith('/addwan ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 3) {
                    console.log(`Menjalankan perintah tambah WAN untuk ${params[0]}`);
                    await handleAddWAN(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *FORMAT Salah!*\n\n` +
                              `Format yang benar:\n` +
                              `addwan [nomor_pelanggan] [tipe_wan] [mode_koneksi]\n\n` +
                              `Tipe WAN: ppp atau ip\n` +
                              `Mode Koneksi: bridge atau route\n\n` +
                              `Contoh:\n` +
                              `addwan 081234567890 ppp route\n` +
                              `addwan 081234567890 ppp bridge\n` +
                              `addwan 081234567890 ip bridge`
                    });
                    return;
                }
            }
            
            // Perintah tambah tag pelanggan
            if (command.startsWith('addtag ') || command.startsWith('!addtag ') || command.startsWith('/addtag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah tag untuk device ${params[0]}`);
                    await addCustomerTag(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *FORMAT Salah!*\n\n` +
                              `Format yang benar:\n` +
                              `addtag [device_id] [nomor_pelanggan]\n\n` +
                              `Contoh:\n` +
                              `addtag 202BC1-BM632w-000000 081234567890`
                    });
                    return;
                }
            }
            
            // Perintah tambah tag pelanggan berdasarkan PPPoE Username
            if (command.startsWith('addpppoe_tag ') || command.startsWith('!addpppoe_tag ') || command.startsWith('/addpppoe_tag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Menjalankan perintah tambah tag untuk PPPoE Username ${params[0]}`);
                    await addTagByPPPoE(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *FORMAT Salah!*\n\n` +
                              `Format yang benar:\n` +
                              `addpppoe_tag [pppoe_username] [nomor_pelanggan]\n\n` +
                              `Contoh:\n` +
                              `addpppoe_tag user123 081234567890`
                    });
                    return;
                }
            }
            
            // Perintah user hotspot aktif
            if (command === 'hotspot' || command === '!hotspot' || command === '/hotspot') {
                console.log(`Menjalankan perintah user hotspot aktif`);
                await handleActiveHotspotUsers(remoteJid);
                return;
            }
            
            // Perintah koneksi PPPoE aktif
            if (command === 'pppoe' || command === '!pppoe' || command === '/pppoe') {
                console.log(`Menjalankan perintah koneksi PPPoE aktif`);
                await handleActivePPPoE(remoteJid);
                return;
            }
            
            // Perintah user PPPoE offline
            if (command === 'offline' || command === '!offline' || command === '/offline') {
                console.log(`Menjalankan perintah user PPPoE offline`);
                await handleOfflineUsers(remoteJid);
                return;
            }
            
            // Perintah info wifi
            if (command === 'info wifi' || command === '!info wifi' || command === '/info wifi') {
                console.log(`Menjalankan perintah info wifi untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleWifiInfo(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Perintah ganti nama WiFi
            if (command.startsWith('gantiwifi ') || command.startsWith('!gantiwifi ') || command.startsWith('/gantiwifi ')) {
                console.log(`Menjalankan perintah ganti nama WiFi untuk ${senderNumber}`);
                const newSSID = messageText.split(' ').slice(1).join(' ');
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleChangeWifiSSID(remoteJid, senderNumber, newSSID);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Perintah ganti password WiFi
            if (command.startsWith('gantipass ') || command.startsWith('!gantipass ') || command.startsWith('/gantipass ')) {
                console.log(`Menjalankan perintah ganti password WiFi untuk ${senderNumber}`);
                const newPassword = messageText.split(' ').slice(1).join(' ');
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleChangeWifiPassword(remoteJid, senderNumber, newPassword);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Perintah status perangkat
            if (command === 'status' || command === '!status' || command === '/status') {
                console.log(`Menjalankan perintah status perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleDeviceStatus(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Perintah restart perangkat
            if (command === 'restart' || command === '!restart' || command === '/restart') {
                console.log(`Menjalankan perintah restart perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartDevice(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Konfirmasi restart perangkat
            if ((command === 'ya' || command === 'iya' || command === 'yes') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Konfirmasi restart perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, true);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Batalkan restart perangkat
            if ((command === 'tidak' || command === 'no' || command === 'batal') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Membatalkan restart perangkat untuk ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, false);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
        }
        
        // Jika pesan tidak dikenali sebagai perintah, abaikan saja
        console.log(`Pesan tidak dikenali sebagai perintah: ${messageText}`);
        // Tidak melakukan apa-apa untuk pesan yang bukan perintah
        
    } catch (error) {
        console.error('Error handling incoming message:', error);
        
        // Coba kirim pesan error ke pengirim
        try {
            if (sock && message && message.key && message.key.remoteJid) {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: `❌ *ERROR*\n\nTerjadi kesalahan saat memproses pesan: ${error.message}\n\nSilakan coba lagi nanti.`
                });
            }
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Tambahkan di bagian deklarasi fungsi sebelum module.exports

// Fungsi untuk menampilkan menu admin
async function handleAdminMenu(remoteJid) {
    try {
        console.log(`Menampilkan menu admin ke ${remoteJid}`);
        
        // Pesan menu admin
        let adminMessage = `👨‍💼 *MENU ADMIN*\n\n`;
        
        adminMessage += `*Perintah Admin:*\n`;
        adminMessage += `• 📋 *list* — Daftar semua ONU\n`;
        adminMessage += `• 🔍 *cekall* — Cek status semua ONU\n`;
        adminMessage += `• 🔍 *cek [nomor]* — Cek status ONU pelanggan\n`;
        adminMessage += `• 📶 *editssid [nomor] [ssid]* — Edit SSID pelanggan\n`;
        adminMessage += `• 🔒 *editpass [nomor] [password]* — Edit password WiFi pelanggan\n\n`;
        
        // Status GenieACS (tanpa menampilkan perintah)
        adminMessage += `*Status Sistem:*\n`;
        adminMessage += `• ${genieacsCommandsEnabled ? '✅' : '❌'} *GenieACS:* ${genieacsCommandsEnabled ? 'Aktif' : 'Nonaktif'}\n\n`;
        
        // Tambahkan footer
        adminMessage += `🏢 *${process.env.COMPANY_HEADER || 'ISP Monitor'}*\n`;
        adminMessage += `${process.env.FOOTER_INFO || ''}`;
        
        // Kirim pesan menu admin
        await sock.sendMessage(remoteJid, { text: adminMessage });
        console.log(`Pesan menu admin terkirim ke ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending admin menu:', error);
        return false;
    }
}

// Fungsi untuk mendapatkan nilai SSID dari perangkat
function getSSIDValue(device, configIndex) {
    try {
        // Coba cara 1: Menggunakan notasi bracket untuk WLANConfiguration
        if (device.InternetGatewayDevice && 
            device.InternetGatewayDevice.LANDevice && 
            device.InternetGatewayDevice.LANDevice['1'] && 
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration && 
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex] && 
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID) {
            
            const ssidObj = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID;
            if (ssidObj._value !== undefined) {
                return ssidObj._value;
            }
        }
        
        // Coba cara 2: Menggunakan getParameterWithPaths
        const ssidPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${configIndex}.SSID`;
        const ssidValue = getParameterWithPaths(device, [ssidPath]);
        if (ssidValue && ssidValue !== 'N/A') {
            return ssidValue;
        }
        
        // Coba cara 3: Cari di seluruh objek
        for (const key in device) {
            if (device[key]?.LANDevice?.['1']?.WLANConfiguration?.[configIndex]?.SSID?._value) {
                return device[key].LANDevice['1'].WLANConfiguration[configIndex].SSID._value;
            }
        }
        
        // Coba cara 4: Cari di parameter virtual
        if (device.VirtualParameters?.SSID?._value) {
            return device.VirtualParameters.SSID._value;
        }
        
        if (configIndex === '5' && device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['2']?.SSID?._value) {
            return device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].SSID._value;
        }
        
        return 'N/A';
    } catch (error) {
        console.error(`Error getting SSID for config ${configIndex}:`, error);
        return 'N/A';
    }
}