const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();
app.use(express.json());

const SPREADSHEET_ID = '1uqP7rdf0T3Qm1GenbF6jZTRRLlM9pd2GMe0NbpiwBIk';

let sock;
let latestQr = null;
let savedCreds = {};

async function useSheetsAuthState() {
    try {
        const response = await axios.get(`https://google.com{SPREADSHEET_ID}/gviz/tq?tqx=out:json`);
        const jsonText = response.data.match(/google\.visualization\.Query\.setResponse\(([\s\S\s]*)\);/);
        const data = JSON.parse(jsonText[1]);
        
        // Correção: Valida se a linha existe e se contém um JSON válido antes de ler
        if (data.table.rows && data.table.rows.length > 0 && data.table.rows[0].c && data.table.rows[0].c[0]) {
            const rawValue = data.table.rows[0].c[0].v;
            if (rawValue && rawValue.startsWith('{')) {
                savedCreds = JSON.parse(rawValue);
                console.log('Credenciais carregadas com sucesso da planilha.');
            }
        }
    } catch (e) {
        console.log('Iniciando com planilha vazia. Aguardando novo QR Code.');
    }

    return {
        state: {
            creds: savedCreds.creds || sock?.authState?.creds || {},
            keys: {
                get: async (type, ids) => {
                    const res = {};
                    for (const id of ids) { if (savedCreds[`${type}-${id}`]) res[id] = savedCreds[`${type}-${id}`]; }
                    return res;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) { savedCreds[`${type}-${id}`] = data[type][id]; }
                    }
                }
            }
        },
        saveCreds: async () => {
            if (sock && sock.authState && sock.authState.creds) {
                savedCreds.creds = sock.authState.creds;
                console.log('=========================================');
                console.log('TOKEN GERADO! COPIE O TEXTO ABAIXO E COLE NA LINHA 2 (A2) DA PLANILHA:');
                console.log(JSON.stringify(savedCreds));
                console.log('=========================================');
            }
        }
    };
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useSheetsAuthState();
    
    sock = makeWASocket({ 
        auth: state,
        browser: ['Ubuntu', 'Chrome', '22.04.4']
    });
    
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQr = qr;
            console.log('Novo QR Code disponível na rota /qr');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 5000); // Aguarda 5 segundos antes de reconectar
            }
        } else if (connection === 'open') {
            latestQr = null;
            console.log('WhatsApp Conectado e autenticado via Sheets!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (msg && !msg.key.fromMe && msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) {
            console.log(`=========================================`);
            console.log(`[GRUPO DETECTADO] ID do Grupo: ${msg.key.remoteJid}`);
            console.log(`=========================================`);
        }
    });
}

app.get('/qr', async (req, res) => {
    if (!latestQr) return res.send('<h1>WhatsApp já conectado ou gerando a sessão. Aguarde 30 segundos e atualize.</h1>');
    try {
        const qrImageBase64 = await QRCode.toDataURL(latestQr);
        res.send(`<div style="text-align: center; margin-top: 50px;"><img src="${qrImageBase64}" style="width:300px;"/></div>`);
    } catch (err) { res.status(500).send('Erro'); }
});

app.post('/webhook', async (req, res) => {
    const { grupoId, mensaje } = req.body;
    try {
        await sock.sendMessage(grupoId, { text: mensaje });
        return res.json({ status: 'Sucesso' });
    } catch (error) { return res.status(500).json({ error: 'Falha' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => connectToWhatsApp());
