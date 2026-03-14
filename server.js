// Database Configuration
const db = new Dexie("BrokeDB");
db.version(1).stores({
    messages: '++id, peerId, text, timestamp, isGhost'
});

const app = {
    peer: null,
    connections: {},
    isAdmin: false,
    isPremium: localStorage.getItem('broke_premium') === 'true',
    activeChatId: null,

    init() {
        // Check Ban Status
        if (localStorage.getItem('broke_banned') === 'true') {
            document.getElementById('ban-screen').classList.remove('hidden');
            return;
        }

        this.setupEventListeners();
        this.heartbeat();
    },

    auth() {
        const id = document.getElementById('admin-id-input').value;
        if (!id) return;

        if (id === 'xeone') {
            this.isAdmin = true;
            document.getElementById('admin-badge').classList.remove('hidden');
            document.getElementById('network-control').classList.remove('hidden');
        }

        this.startPeer(id === 'xeone' ? 'admin-' + Math.random().toString(36).substr(2, 5) : null);
        document.getElementById('admin-auth').classList.add('hidden');
        document.getElementById('app-interface').classList.remove('hidden');
    },

    startPeer(customId) {
        this.peer = new Peer(customId, {
            debug: 2
        });

        this.peer.on('open', (id) => {
            document.getElementById('my-id-display').innerText = `ID: ${id}`;
        });

        this.peer.on('connection', (conn) => this.handleConnection(conn));
        
        this.peer.on('call', (call) => {
            if(confirm("Incoming Call... Accept?")) {
                navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(stream => {
                    call.answer(stream);
                    this.handleStream(call);
                });
            }
        });
    },

    handleConnection(conn) {
        this.connections[conn.peer] = conn;
        conn.on('data', (data) => this.handleData(data, conn.peer));
    },

    handleData(data, fromPeer) {
        // System Commands Logic
        if (data.type === 'CMD_BAN') {
            localStorage.setItem('broke_banned', 'true');
            location.reload();
        }
        if (data.type === 'CMD_GIVE_PREMIUM') {
            localStorage.setItem('broke_premium', 'true');
            this.isPremium = true;
            location.reload();
        }
        if (data.type === 'CMD_PURGE') {
            db.messages.clear();
            alert("History purged by admin.");
        }

        // Chat Logic
        if (data.type === 'TEXT') {
            this.displayMessage(fromPeer, data.text, data.isGhost);
            if (data.destruct) {
                setTimeout(() => {
                    // Logic to remove from UI
                    console.log("Self-destructed");
                }, data.destruct);
            }
        }
    },

    sendMessage() {
        const text = document.getElementById('msg-input').value;
        const target = document.getElementById('remote-id-input').value;
        const destruct = parseInt(document.getElementById('destruct-timer').value);

        if (!text || !target) return;

        const payload = {
            type: 'TEXT',
            text: text,
            isGhost: this.isPremium,
            destruct: destruct > 0 ? destruct : null
        };

        if (this.connections[target]) {
            this.connections[target].send(payload);
            this.displayMessage('You', text, this.isPremium);
            document.getElementById('msg-input').value = '';
        }
    },

    adminAction(action) {
        const target = document.getElementById('target-id').value;
        if (!target) return alert("Enter Target ID");

        let conn = this.connections[target];
        if (!conn) {
            conn = this.peer.connect(target);
        }

        setTimeout(() => {
            if (action === 'BAN') conn.send({ type: 'CMD_BAN' });
            if (action === 'GIVE_PREMIUM') conn.send({ type: 'CMD_GIVE_PREMIUM' });
            if (action === 'PURGE') conn.send({ type: 'CMD_PURGE' });
        }, 1000);
    },

    displayMessage(sender, text, isGhost) {
        const container = document.getElementById('chat-messages');
        const div = document.createElement('div');
        div.className = `message ${isGhost ? 'msg-ghost' : ''}`;
        div.innerHTML = `<b>${sender}:</b> ${text}`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        
        db.messages.add({ peerId: sender, text, timestamp: Date.now(), isGhost });
    },

    setupEventListeners() {
        // Panic Button (Esc)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPremium) {
                document.body.classList.toggle('panic-active');
            }
        });

        // Anti-Spy (Blur on focus loss)
        window.addEventListener('blur', () => {
            if (this.isPremium) document.body.classList.add('panic-active');
        });
        window.addEventListener('focus', () => {
            document.body.classList.remove('panic-active');
        });

        if (this.isPremium) {
            document.getElementById('premium-badge').classList.remove('hidden');
            document.querySelectorAll('.ghost-only').forEach(el => el.style.display = 'block');
        }
    },

    heartbeat() {
        // Keep connection alive for Render.com/Static hosts
        setInterval(() => {
            if (this.peer && !this.peer.destroyed) {
                this.peer.socket.send({type: 'HEARTBEAT'});
            }
        }, 15000);
    },

    connectToPeer() {
        const id = document.getElementById('remote-id-input').value;
        const conn = this.peer.connect(id);
        this.handleConnection(conn);
    }
};

// Start the engine
app.init();
