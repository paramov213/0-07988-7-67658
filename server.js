const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'users.json');

// Загрузка базы данных из файла при старте
let db = { users: {} };
if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE));
}

// Функция сохранения
const saveDB = () => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
};

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    // Регистрация
    socket.on('register', (data) => {
        if (db.users[data.login]) {
            socket.emit('auth-error', 'Логин уже занят');
        } else {
            db.users[data.login] = data.password;
            saveDB();
            socket.userName = data.login;
            socket.emit('auth-success', { user: data.login });
        }
    });

    // Вход
    socket.on('login', (data) => {
        if (db.users[data.login] && db.users[data.login] === data.password) {
            socket.userName = data.login;
            socket.emit('auth-success', { user: data.login });
        } else {
            socket.emit('auth-error', 'Неверный логин или пароль');
        }
    });

    // Сообщения
    socket.on('message', (data) => {
        io.emit('message', {
            text: data.text,
            image: data.image,
            user: socket.userName || 'Аноним',
            time: new Date().toLocaleTimeString()
        });
    });

    // WebRTC сигналинг
    socket.on('call-signal', (data) => {
        socket.broadcast.emit('call-signal', data);
    });
});

// Для Render: предотвращение "засыпания" (самопрозвон)
setInterval(() => {
    http.get(`http://localhost:${process.env.PORT || 3000}`);
}, 10 * 60 * 1000); 

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
