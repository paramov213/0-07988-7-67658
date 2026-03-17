const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 5e6, // Ограничение 5МБ, чтобы сервер не падал от тяжелых фото
    pingTimeout: 30000 
});
const fs = require('fs');

const DB_FILE = './users.json';
const MSG_FILE = './messages.json';

let db = { users: {} };
let history = [];

// Загрузка с проверкой на ошибки
try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE));
    if (fs.existsSync(MSG_FILE)) history = JSON.parse(fs.readFileSync(MSG_FILE));
} catch (e) { console.log("Ошибка БД, создаем чистую"); }

const saveData = () => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    fs.writeFileSync(MSG_FILE, JSON.stringify(history, null, 2));
};

app.use(express.static(__dirname));
const activeSockets = {}; 

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        const login = data.login.trim().toLowerCase();
        if (data.type === 'register') {
            if (db.users[login]) return socket.emit('auth-error', 'Занят');
            db.users[login] = { password: data.password, displayName: data.login, bio: "", avatar: "" };
            saveData();
        } else {
            if (!db.users[login] || db.users[login].password !== data.password) return socket.emit('auth-error', 'Ошибка');
        }
        socket.userName = login;
        activeSockets[login] = socket.id;
        
        const userHistory = history.filter(m => m.from === login || m.to === login);
        socket.emit('auth-success', { user: login, profile: db.users[login], history: userHistory });
    });

    socket.on('private-message', (data) => {
        if (!socket.userName) return;
        const msg = {
            from: socket.userName,
            to: data.to,
            text: data.text,
            image: data.image,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            ts: Date.now()
        };
        history.push(msg);
        if (history.length > 1000) history.shift(); // Храним последние 1000, чтоб хостинг не лагал
        saveData();
        
        if (activeSockets[data.to]) io.to(activeSockets[data.to]).emit('msg-receive', msg);
        socket.emit('msg-receive', msg);
    });

    socket.on('update-profile', (data) => {
        if (db.users[socket.userName]) {
            // Ограничение размера аватарки в БД
            if(data.avatar && data.avatar.length > 1000000) return; 
            Object.assign(db.users[socket.userName], data);
            saveData();
            socket.emit('profile-updated', db.users[socket.userName]);
        }
    });

    socket.on('disconnect', () => { delete activeSockets[socket.userName]; });
});

// Пинг-понг для поддержания жизни на бесплатных хостингах
setInterval(() => io.emit('ping'), 25000);

http.listen(3000, '0.0.0.0', () => console.log('Celestra Discord Edition Ready'));
