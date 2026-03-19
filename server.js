const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Конфигурация
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'discord_nitro_secret_key_2026';
const MONGODB_URI = 'mongodb://localhost:27017/messenger_db'; // Замените на вашу строку подключения

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Схемы БД
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    displayName: String,
    bio: String,
    avatar: { type: String, default: 'https://i.imgur.com/6VBx3io.png' },
    banner: { type: String, default: 'https://i.imgur.com/w9O963v.png' },
    glowColor: { type: String, default: 'rgba(88, 101, 242, 0.5)' },
    lastSeen: { type: Date, default: Date.now },
    isOnline: { type: Boolean, default: false }
});

const MessageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});

const StreakSchema = new mongoose.Schema({
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    count: { type: Number, default: 1 },
    lastInteraction: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Streak = mongoose.model('Streak', StreakSchema);

// Подключение к БД
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('DB Connection Error:', err));

// API: Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username already taken' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            username, 
            password: hashedPassword, 
            displayName: username 
        });
        await newUser.save();

        const token = jwt.sign({ id: newUser._id }, JWT_SECRET);
        res.json({ token, user: newUser });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Логин
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id }, JWT_SECRET);
        res.json({ token, user });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Socket.io Логика
const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('authenticate', async (token) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findById(decoded.id);
            if (user) {
                user.isOnline = true;
                await user.save();
                onlineUsers.set(user._id.toString(), socket.id);
                socket.userId = user._id.toString();
                io.emit('userStatusUpdate', { userId: user._id, isOnline: true });
            }
        } catch (err) {
            socket.disconnect();
        }
    });

    socket.on('sendMessage', async (data) => {
        const { receiverId, text } = data;
        const newMessage = new Message({
            sender: socket.userId,
            receiver: receiverId,
            text
        });
        await newMessage.save();

        // Логика Стриков (Огней)
        let streak = await Streak.findOne({
            users: { $all: [socket.userId, receiverId] }
        });

        if (!streak) {
            streak = new Streak({ users: [socket.userId, receiverId], count: 1 });
            await streak.save();
        } else {
            const now = new Date();
            const diff = (now - streak.lastInteraction) / (1000 * 60 * 60);
            if (diff > 24 && diff < 48) {
                streak.count += 1;
            } else if (diff >= 48) {
                streak.count = 1;
            }
            streak.lastInteraction = now;
            await streak.save();
        }

        const receiverSocket = onlineUsers.get(receiverId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('newMessage', newMessage);
            io.to(receiverSocket).emit('updateStreak', streak);
        }
        socket.emit('newMessage', newMessage);
    });

    socket.on('disconnect', async () => {
        if (socket.userId) {
            const user = await User.findById(socket.userId);
            if (user) {
                user.isOnline = false;
                user.lastSeen = new Date();
                await user.save();
                onlineUsers.delete(socket.userId);
                io.emit('userStatusUpdate', { userId: user._id, isOnline: false, lastSeen: user.lastSeen });
            }
        }
    });
});

// Пинг-скрипт для предотвращения сна (Render/Railway)
setInterval(() => {
    http.get(`http://localhost:${PORT}/ping`);
}, 1000 * 60 * 10);

app.get('/ping', (req, res) => res.send('pong'));

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
