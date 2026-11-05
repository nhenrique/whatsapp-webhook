const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');

const app = express();
app.use(express.json());

let sock;
let latestQr = null; // Guarda o QR Code atual para exibir na página web

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQr = qr; // Atualiza o QR Code
            console.log('Novo QR Code gerado! Acesse a rota /qr para escanear.');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            latestQr = null; // Apaga o QR Code após conectar
            console.log('=========================================');
            console.log('Sua API está ONLINE e conectada ao WhatsApp!');
            console.log('=========================================');
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

// ROTA NOVA: Exibe o QR Code perfeitamente na tela do navegador
app.get('/qr', (req, res) => {
    if (!latestQr) {
        return res.send('<h1>O WhatsApp já está conectado ou o QR Code ainda não foi gerado.</h1>');
    }
    // Cria uma página simples gerando o QR Code usando a API do Google Charts
    const qrUrl = `https://googleapis.com{encodeURIComponent(latestQr)}`;
    res.send(`
        <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
            <h1>Escaneie o QR Code abaixo:</h1>
            <img src="${qrUrl}" alt="QR Code WhatsApp" style="border: 1px solid #ccc; padding: 10px;" />
            <p>Atualize a página se o código expirar.</p>
        </div>
    `);
});

// Rota para o Webhook de envio de mensagens
app.post('/webhook', async (req, res) => {
    const { grupoId, mensagem } = req.body;

    if (!grupoId || !mensagem) {
        return res.status(400).json({ error: 'Faltam os campos grupoId ou mensagem no JSON' });
    }

    try {
        await sock.sendMessage(grupoId, { text: mensagem });
        return res.json({ status: 'Sucesso', mensagem: 'Enviada com sucesso!' });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        return res.status(500).json({ error: 'Falha ao enviar a mensagem' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    connectToWhatsApp();
});
