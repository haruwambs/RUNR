/* =========================================================
   RUNR APP - PRODUCTION FRONTEND LOGIC (SUPABASE)
   ========================================================= */

// 1. SUPABASE CONFIGURATION (Replace with your actual keys)
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = {
    state: {
        currentUser: null,
        currentTheme: 'light',
        logoClickCount: 0,
        currentQuestId: null,
        realtimeChannel: null,
    },

    // 2. INITIALIZATION & AUTH
    async init() {
        this.loadTheme();
        this.renderIcons();
        this.setupEventListeners();
        
        // Check if user is already logged in
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            await this.setCurrentUser(session.user);
            this.navigate('home');
        } else {
            this.navigate('onboarding');
        }

        // Listen for auth changes (login/logout)
        supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN') {
                await this.setCurrentUser(session.user);
                this.navigate('home');
            } else if (event === 'SIGNED_OUT') {
                this.state.currentUser = null;
                this.navigate('onboarding');
            }
        });
    },

    async setCurrentUser(authUser) {
        // Fetch user profile from public.users table
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();
        
        if (data) {
            this.state.currentUser = data;
            this.updateProfileUI();
        }
    },

    // 3. REAL AUTHENTICATION (Phone OTP)
    async sendOTP() {
        const phoneInput = document.querySelector('input[type="tel"]');
        const phone = phoneInput.value.replace(/\s/g, '');
        
        if (phone.length < 9) return this.toast('Enter a valid phone number');

        this.toast('Sending code...');
        const { error } = await supabase.auth.signInWithOtp({
            phone: `+260${phone}`, // Assuming Zambia prefix
        });

        if (error) return this.toast(error.message);

        // Show OTP input (You would add a modal or new screen for this)
        const otp = prompt('Enter the 4-digit code sent to your phone:');
        
        if (otp) {
            const { error: verifyError } = await supabase.auth.verifyOtp({
                phone: `+260${phone}`,
                token: otp,
                type: 'sms'
            });
            if (verifyError) this.toast(verifyError.message);
        }
    },

    async logout() {
        await supabase.auth.signOut();
        this.toast('Logged out');
    },

    // 4. POST QUEST TO DATABASE
    async postQuest(event) {
        event.preventDefault();
        if (!this.state.currentUser) return this.toast('Please log in first');

        const form = event.target;
        const sizeType = document.querySelector('.size-card.active .size-info h4').textContent.includes('Small') ? 'lite' : 'driver';
        const pickup = form.querySelectorAll('input[type="text"]')[0].value;
        const dropoff = form.querySelectorAll('input[type="text"]')[1].value;
        
        if (!pickup || !dropoff) return this.toast('Please fill in all fields');

        this.toast('Posting quest...');

        const { data, error } = await supabase
            .from('quests')
            .insert([{
                hirer_id: this.state.currentUser.id,
                title: sizeType === 'lite' ? 'Small Errand' : 'Big Errand',
                description: `Pickup at ${pickup} and deliver to ${dropoff}`,
                price: sizeType === 'lite' ? 50 : 200,
                status: 'open',
                pickup_location: pickup,
                dropoff_location: dropoff,
                is_urgent: false,
                created_at: new Date().toISOString()
            }])
            .select();

        if (error) return this.toast(error.message);

        this.toast('Quest posted successfully!');
        this.navigate('home');
        this.loadQuests(); // Reload the feed
    },

    // 5. FETCH REAL QUESTS FROM DATABASE
    async loadQuests() {
        const container = document.getElementById('quest-list-container');
        if (!container) return;

        const { data: quests, error } = await supabase
            .from('quests')
            .select('*')
            .eq('status', 'open')
            .order('created_at', { ascending: false });

        if (error) return console.error(error);

        if (quests.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i data-lucide="clipboard-list"></i></div>
                    <h4>No quests available</h4>
                    <p>Post a quest to get started.</p>
                </div>`;
        } else {
            container.innerHTML = quests.map(quest => `
                <div class="quest-item" onclick="app.openQuest('${quest.id}')">
                    <div class="quest-info">
                        <h4>${quest.title}</h4>
                        <p>${quest.pickup_location} → ${quest.dropoff_location}</p>
                    </div>
                    <div class="quest-price">K${quest.price}</div>
                </div>
            `).join('');
        }
        this.renderIcons();
    },

    // 6. REAL-TIME CHAT
    async openQuest(questId) {
        this.state.currentQuestId = questId;
        this.navigate('questDetails');
        
        // Load chat history
        await this.loadMessages(questId);
        
        // Subscribe to real-time messages for this quest
        if (this.state.realtimeChannel) {
            supabase.removeChannel(this.state.realtimeChannel);
        }

        this.state.realtimeChannel = supabase
            .channel(`quest-chat-${questId}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages',
                filter: `quest_id=eq.${questId}`
            }, payload => {
                this.appendMessage(payload.new);
            })
            .subscribe();
    },

    async loadMessages(questId) {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('quest_id', questId)
            .order('created_at', { ascending: true });

        if (error) return console.error(error);

        const chatContainer = document.querySelector('.chat-messages');
        chatContainer.innerHTML = ''; // Clear existing

        messages.forEach(msg => this.appendMessage(msg));
    },

    appendMessage(msg) {
        const chatContainer = document.querySelector('.chat-messages');
        if (!chatContainer) return;

        const isMe = msg.sender_id === this.state.currentUser.id;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMe ? 'sent' : 'received'}`;
        msgDiv.textContent = msg.message;
        
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    },

    async sendMessage(event) {
        event.preventDefault();
        const input = event.target.querySelector('input');
        const message = input.value.trim();
        if (!message || !this.state.currentQuestId) return;

        input.value = ''; // Clear input immediately

        // Insert into database (Realtime subscription will handle UI update)
        const { error } = await supabase
            .from('messages')
            .insert([{
                quest_id: this.state.currentQuestId,
                sender_id: this.state.currentUser.id,
                message: message,
                created_at: new Date().toISOString()
            }]);

        if (error) {
            this.toast('Failed to send message');
            console.error(error);
        }
    },

    // 7. REAL KYC UPLOAD
    async uploadKYC(event, type) {
        const file = event.target.files[0];
        if (!file) return;

        this.toast('Uploading...');

        // 1. Upload image to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${this.state.currentUser.id}-${type}-${Date.now()}.${fileExt}`;
        const filePath = `${this.state.currentUser.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('kyc-documents')
            .upload(filePath, file);

        if (uploadError) return this.toast(uploadError.message);

        // 2. Save file path to user profile
        const updateData = type === 'nrc' ? { nrc_url: filePath } : { selfie_url: filePath };
        
        const { error: updateError } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', this.state.currentUser.id);

        if (updateError) return this.toast(updateError.message);

        this.toast('Document uploaded successfully!');
    },

    // 8. REAL SUBSCRIPTION PAYMENT
    async submitPayment() {
        const txnId = prompt("Enter your MoMo Transaction ID:");
        if (!txnId || txnId.length < 5) return this.toast('Invalid Transaction ID');

        const { error } = await supabase
            .from('subscriptions')
            .insert([{
                user_id: this.state.currentUser.id,
                plan: 'pro_weekly',
                status: 'pending',
                transaction_id: txnId,
                created_at: new Date().toISOString()
            }]);

        if (error) return this.toast(error.message);

        this.toast('Payment submitted! Awaiting admin approval.');
    },

    // 9. UI HELPERS
    updateProfileUI() {
        const nameEl = document.querySelector('.profile-hero h2');
        if (nameEl && this.state.currentUser) {
            nameEl.textContent = this.state.currentUser.name || 'User';
        }
    },

    navigate(screenId) {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(`screen-${screenId}`);
        if (target) {
            target.classList.add('active');
            target.scrollTop = 0;
        }

        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const navBtn = document.getElementById(`nav-${screenId}`);
        if (navBtn) navBtn.classList.add('active');

        // Load data specific to screens
        if (screenId === 'home') this.loadQuests();

        this.renderIcons();
    },

    toggleTheme() {
        const html = document.documentElement;
        const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', next);
        localStorage.setItem('runr-theme', next);
        
        const toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.classList.toggle('on', next === 'dark');
    },

    loadTheme() {
        const saved = localStorage.getItem('runr-theme') || 'light';
        document.documentElement.setAttribute('data-theme', saved);
        const toggle = document.getElementById('theme-toggle');
        if (toggle) toggle.classList.toggle('on', saved === 'dark');
    },

    handleLogoClick() {
        this.state.logoClickCount++;
        clearTimeout(this.logoTimer);
        this.logoTimer = setTimeout(() => { this.state.logoClickCount = 0; }, 2000);

        if (this.state.logoClickCount >= 5) {
            this.state.logoClickCount = 0;
            this.navigate('admin');
            this.toast('🔓 Admin access granted');
        }
    },

    selectSize(element) {
        document.querySelectorAll('.size-card').forEach(el => el.classList.remove('active'));
        element.classList.add('active');
    },

    toast(message) {
        document.querySelectorAll('.app-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = 'app-toast';
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '100px', left: '50%', transform: 'translateX(-50%)',
            background: '#111827', color: '#ffffff', padding: '12px 24px', borderRadius: '30px',
            fontSize: '14px', fontWeight: '600', boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            zIndex: '9999', animation: 'fadeIn 0.3s ease', maxWidth: '90%', textAlign: 'center',
            pointerEvents: 'none'
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
    },

    renderIcons() {
        if (window.lucide) lucide.createIcons();
    },

    setupEventListeners() {
        // Attach chat form
        const chatForm = document.querySelector('.chat-input');
        if (chatForm) chatForm.addEventListener('submit', (e) => this.sendMessage(e));
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
