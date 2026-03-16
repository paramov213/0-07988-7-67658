const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');

const DB_FILE = './users.json';
let db = { users: {} };

// Загрузка базы данных
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { console.log("Ошибка БД"); }
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

app.use(express.static(__dirname));

const activeSockets = {}; // login -> socketId
const userStatus = {};    // login -> status string

io.on('connection', (socket) => {
    // Авторизация и Регистрация
    socket.on('auth', (data) => {
        if (data.type === 'register') {
            if (db.users[data.login]) return socket.emit('auth-error', 'Логин занят');
            db.users[data.login] = data.password;
            saveDB();
        } else {
            if (!db.users[data.login] || db.users[data.login] !== data.password) {
                return socket.emit('auth-error', 'Неверный логин или пароль');
            }
        }
        
        socket.userName = data.login;
        activeSockets[data.login] = socket.id;
        userStatus[data.login] = 'online';
        
        io.emit('user-status-update', { user: data.login, status: 'online' });
        socket.emit('auth-success', { user: data.login });
        console.log(`${data.login} вошел в Celestra`);
    });

    // Поиск
    socket.on('search-user', (username) => {
        if (db.users[username]) {
            socket.emit('search-result', { exists: true, username });
        } else {
            socket.emit('search-result', { exists: false });
        }
    });

    // Запрос статуса
    socket.on('get-status', (username) => {
        socket.emit('status-result', { 
            user: username, 
            status: userStatus[username] || 'был(а) недавно' 
        });
    });

    // Приватные сообщения
    socket.on('private-message', (data) => {
        const msg = {
            from: socket.userName,
            to: data.to,
            text: data.text,
            image: data.image,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (activeSockets[data.to]) io.to(activeSockets[data.to]).emit('msg-receive', msg);
        socket.emit('msg-receive', msg);
    });

    // Звонки
    socket.on('call-request', (data) => {
        if (activeSockets[data.to]) {
            io.to(activeSockets[data.to]).emit('incoming-call', { from: socket.userName });
        }
    });

    socket.on('disconnect', () => {
        if (socket.userName) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            userStatus[socket.userName] = `был(а) в ${time}`;
            io.emit('user-status-update', { user: socket.userName, status: userStatus[socket.userName] });
            delete activeSockets[socket.userName];
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => console.log(`Celestra Server on port ${PORT}`));
