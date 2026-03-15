const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

const DB_FILE = './users.json';

// Загрузка/создание базы данных
let db = { users: {} };
if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) { console.log("Ошибка чтения БД"); }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    // Регистрация
    socket.on('register', (data) => {
        if (db.users[data.login]) {
            return socket.emit('auth-error', 'Логин уже занят');
        }
        db.users[data.login] = data.password;
        saveDB();
        socket.userName = data.login;
        socket.emit('auth-success', { user: data.login });
    });

    // Вход
    socket.on('login', (data) => {
        if (db.users[data.login] && db.users[data.login] === data.password) {
            socket.userName = data.login;
            socket.emit('auth-success', { user: data.login });
        } else {
            socket.emit('auth-error', 'Ошибка входа');
        }
    });

    // Сообщения и фото
    socket.on('message', (data) => {
        io.emit('message', {
            text: data.text,
            image: data.image,
            user: socket.userName || 'Аноним',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    // Сигналинг звонков
    socket.on('call-signal', (data) => {
        socket.broadcast.emit('call-signal', data);
    });
});

// Пинг самого себя для Render (каждые 10 минут)
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
