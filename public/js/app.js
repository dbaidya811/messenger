let socket = null;
let currentUserId = null;
let chattingWith = null;

// ---------------- Push Notification (Web Push) ----------------
// Replace with your own generated VAPID public key (Base64-url string)
const PUBLIC_VAPID_KEY = 'REPLACE_WITH_YOUR_PUBLIC_VAPID_KEY';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i=0;i<rawData.length;++i){outputArray[i]=rawData.charCodeAt(i);}return outputArray;
}

async function registerPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !currentUserId) return;
  try{
    const reg = await navigator.serviceWorker.register('/sw.js');
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(PUBLIC_VAPID_KEY)});
    }
    await fetch('/api/save-sub', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({userId: currentUserId, sub})});
  }catch(err){console.warn('[push] setup failed', err);}
}
// ----------------------------------------------------------------

// UI Elements
// ---------------- Socket helper ----------------
function initSocket() {
  if (socket) return;
  socket = io();
  if (currentUserId) {
    socket.emit('join', currentUserId);
  }
  // Auto-open chat tab on incoming VIDEO call
  socket.on('incoming_video', ({from, offer})=>{
    try { sessionStorage.setItem('pendingVideoOffer', JSON.stringify({from, offer})); } catch{}
    const popup = window.open(`chat.html?userId=${from}`, '_blank');
    if(!popup){
      alert(`${from} is video calling you ‑ open their chat to answer.`);
    }
  });
  // Auto-open chat tab on incoming VOICE call (optional)
  socket.on('incoming_call', ({from, offer})=>{
    console.log('DEBUG - App.js incoming call from:', from);
    try { sessionStorage.setItem('pendingVoiceOffer', JSON.stringify({from, offer})); } catch{}
    const popup = window.open(`chat.html?userId=${from}`, '_blank');
    if(!popup){
      const callerId = from; // Explicitly use the caller's ID
      alert(`${callerId} is calling you - open their chat to answer.`);
    }
  });
  // --- Call Notification Sound ---
  const callSound = new Audio('/notification.mp3'); // Place notification.mp3 in public/

  function showCallNotification(type, from, offer) {
    // Play notification sound
    callSound.play().catch(()=>{});
    // Show a simple confirm popup (replace with custom modal if needed)
    if(confirm(`${from} is ${type === 'video' ? 'video calling' : 'calling'} you. Open chat?`)){
      window.open(`chat.html?userId=${from}`, '_blank');
    }
  }

  socket.on('incoming_call', ({from, offer}) => {
    showCallNotification('voice', from, offer);
  });
  socket.on('incoming_video', ({from, offer}) => {
    showCallNotification('video', from, offer);
  });
}
// -------------------------------------------------

const signupBox = document.getElementById('signup-box');
const loginBox = document.getElementById('login-box');
const showLogin = document.getElementById('show-login');
const showSignup = document.getElementById('show-signup');
const signupBtn = document.getElementById('signup-btn');
const loginBtn = document.getElementById('login-btn');
const signupError = document.getElementById('signup-error');
const loginError = document.getElementById('login-error');
const chatContainer = document.getElementById('chat-container');
const authContainer = document.getElementById('auth-container');
const userList = document.getElementById('user-list');
const chatBox = document.getElementById('chat-box');
const chatWith = document.getElementById('chat-with');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const closeChatBtn = document.getElementById('close-chat');
// Dropdown menu elements
const profileMenu = document.getElementById('profile-menu');
const profileAvatar = document.getElementById('profile-avatar');
const logoutBtn = document.getElementById('logoutBtn');
const deleteBtn = document.getElementById('deleteBtn');
function updateAvatar(){
  if (profileAvatar){
    profileAvatar.textContent = currentUserId ? currentUserId.charAt(0).toUpperCase() : '?';
  }
}
// Toggle dropdown and rebuild items each time avatar clicked
if(profileAvatar){
  profileAvatar.onclick = (e)=>{
    e.stopPropagation();
    if(profileMenu.style.display==='block'){
      profileMenu.style.display='none';
      return;
    }
    buildProfileMenu();
    profileMenu.style.display='block';
  };
  // hide menu on outside click
  document.addEventListener('click',()=>{profileMenu.style.display='none';});
}

function buildProfileMenu(){
  profileMenu.innerHTML='';
  // Account button
  const accountBtn = document.createElement('button');
  accountBtn.textContent = 'Account';
  accountBtn.onclick = showAccountModal;
  profileMenu.appendChild(accountBtn);
  // Delete Account
  const delBtn=document.createElement('button');
  delBtn.textContent='Delete Account';
  delBtn.onclick=showDeleteAccountModal;
  profileMenu.appendChild(delBtn);
  // Logout
  const logBtn=document.createElement('button');
  logBtn.textContent='Logout';
  logBtn.onclick=handleLogout;
  profileMenu.appendChild(logBtn);
}

function showAccountModal() {
  const userList = JSON.parse(localStorage.getItem('userList') || '[]');
  const user = userList.find(u => u.userId === currentUserId) || {};
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card account-modal">
      <span class="user-avatar" style="width:110px;height:110px;font-size:2.8em;">${user.name ? user.name.charAt(0).toUpperCase() : (user.userId||'U').charAt(0).toUpperCase()}</span>
      <div class="account-fields" style="width:100%;margin-top:18px;">
        <div class="account-row">
          <span class="account-value" id="acc-name">${user.name||''}</span>
          <button class="edit-btn" id="edit-name-btn">Edit</button>
        </div>
        <div class="account-row">
          <span class="account-value" id="acc-email">${user.userId||''}</span>
          <button class="edit-btn" id="edit-email-btn">Edit</button>
        </div>
        <div class="account-row">
          <span class="account-value" id="acc-pass">******</span>
          <button class="edit-btn" id="edit-pass-btn">Edit</button>
        </div>
      </div>
      <div class="account-actions">
        <button id="acc-close" class="close-btn">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('acc-close').onclick = () => modal.remove();
  // Name edit: open mini-modal
  document.getElementById('edit-name-btn').onclick = () => {
    showEditNameModal(user.name||'');
  };
  document.getElementById('edit-email-btn').onclick = () => {
    showEditEmailModal(user.userId||'');
  };
  document.getElementById('edit-pass-btn').onclick = () => {
    showEditPassModal();
  };
}

function showEditNameModal(currentName) {
  const old = document.querySelector('.mini-modal');
  if (old) old.remove();
  const mini = document.createElement('div');
  mini.className = 'mini-modal';
  mini.innerHTML = `
    <label style="font-weight:600;margin-bottom:8px;">Edit Name</label>
    <input type="text" id="mini-name-input" value="${currentName||''}" maxlength="32">
    <div class="mini-actions">
      <button id="mini-cancel">Cancel</button>
      <button id="mini-save">Save</button>
    </div>
    <div id="mini-error" class="error"></div>
  `;
  document.body.appendChild(mini);
  document.getElementById('mini-cancel').onclick = () => mini.remove();
  document.getElementById('mini-save').onclick = async () => {
    const newName = document.getElementById('mini-name-input').value.trim();
    const miniError = document.getElementById('mini-error');
    if (!newName) { miniError.textContent = 'Name required.'; return; }
    const res = await fetch('/api/update-name', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, name: newName })
    });
    const data = await res.json();
    if (res.ok) {
      miniError.textContent = 'Name updated!';
      let userList = JSON.parse(localStorage.getItem('userList') || '[]');
      userList = userList.map(u => u.userId === currentUserId ? { ...u, name: newName } : u);
      localStorage.setItem('userList', JSON.stringify(userList));
      const accName = document.getElementById('acc-name');
      if (accName) accName.textContent = newName;
      setTimeout(() => mini.remove(), 600);
    } else {
      miniError.textContent = data.message || 'Failed to update name.';
    }
  };
}

function showEditEmailModal(currentEmail) {
  const old = document.querySelector('.mini-modal');
  if (old) old.remove();
  const mini = document.createElement('div');
  mini.className = 'mini-modal';
  mini.innerHTML = `
    <label style="font-weight:600;margin-bottom:8px;">Edit Email</label>
    <input type="email" id="mini-email-input" value="${currentEmail||''}" maxlength="64">
    <button id="mini-send-email-otp" style="margin-bottom:8px;">Send OTP</button>
    <input type="text" id="mini-email-otp" placeholder="Enter OTP" style="display:none;margin-bottom:8px;">
    <div class="mini-actions">
      <button id="mini-cancel">Cancel</button>
      <button id="mini-save" style="display:none;">Verify & Save</button>
    </div>
    <div id="mini-error" class="error"></div>
  `;
  document.body.appendChild(mini);
  document.getElementById('mini-cancel').onclick = () => mini.remove();
  document.getElementById('mini-send-email-otp').onclick = async () => {
    const newEmail = document.getElementById('mini-email-input').value.trim();
    const miniError = document.getElementById('mini-error');
    if (!newEmail) { miniError.textContent = 'Email required.'; return; }
    const res = await fetch('/api/request-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, type: 'change-email', userId: currentUserId })
    });
    const data = await res.json();
    if (res.ok) {
      miniError.textContent = 'OTP sent to new email.';
      document.getElementById('mini-email-otp').style.display = 'block';
      document.getElementById('mini-save').style.display = 'inline-block';
    } else {
      miniError.textContent = data.message || 'Failed to send OTP.';
    }
  };
  document.getElementById('mini-save').onclick = async () => {
    const newEmail = document.getElementById('mini-email-input').value.trim();
    const otp = document.getElementById('mini-email-otp').value.trim();
    const miniError = document.getElementById('mini-error');
    if (!newEmail || !otp) { miniError.textContent = 'All fields required.'; return; }
    const res = await fetch('/api/update-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, newEmail, otp })
    });
    const data = await res.json();
    if (res.ok) {
      miniError.textContent = 'Email updated!';
      let userList = JSON.parse(localStorage.getItem('userList') || '[]');
      userList = userList.map(u => u.userId === currentUserId ? { ...u, userId: newEmail } : u);
      localStorage.setItem('userList', JSON.stringify(userList));
      localStorage.setItem('currentUserId', newEmail);
      const accEmail = document.getElementById('acc-email');
      if (accEmail) accEmail.textContent = newEmail;
      setTimeout(() => mini.remove(), 600);
    } else {
      miniError.textContent = data.message || 'Failed to update email.';
    }
  };
}

function showEditPassModal() {
  const old = document.querySelector('.mini-modal');
  if (old) old.remove();
  const mini = document.createElement('div');
  mini.className = 'mini-modal';
  mini.innerHTML = `
    <label style="font-weight:600;margin-bottom:8px;">Edit Password</label>
    <input type="password" id="mini-pass-input" placeholder="New Password" maxlength="64">
    <div style="margin-bottom:8px;text-align:right;">
      <a href="#" id="mini-forgot" style="color:#25d366;text-decoration:underline;font-size:0.98em;">Forgot password?</a>
    </div>
    <button id="mini-send-pass-otp" style="margin-bottom:8px;">Send OTP</button>
    <input type="text" id="mini-pass-otp" placeholder="Enter OTP" style="display:none;margin-bottom:8px;">
    <div class="mini-actions">
      <button id="mini-cancel">Cancel</button>
      <button id="mini-save" style="display:none;">Verify & Save</button>
    </div>
    <div id="mini-error" class="error"></div>
  `;
  document.body.appendChild(mini);
  document.getElementById('mini-cancel').onclick = () => mini.remove();
  document.getElementById('mini-send-pass-otp').onclick = async () => {
    const newPass = document.getElementById('mini-pass-input').value;
    const miniError = document.getElementById('mini-error');
    if (!newPass) { miniError.textContent = 'Password required.'; return; }
    const res = await fetch('/api/request-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUserId, type: 'change-password' })
    });
    const data = await res.json();
    if (res.ok) {
      miniError.textContent = 'OTP sent to your email.';
      document.getElementById('mini-pass-otp').style.display = 'block';
      document.getElementById('mini-save').style.display = 'inline-block';
    } else {
      miniError.textContent = data.message || 'Failed to send OTP.';
    }
  };
  document.getElementById('mini-save').onclick = async () => {
    const newPass = document.getElementById('mini-pass-input').value;
    const otp = document.getElementById('mini-pass-otp').value.trim();
    const miniError = document.getElementById('mini-error');
    if (!newPass || !otp) { miniError.textContent = 'All fields required.'; return; }
    const res = await fetch('/api/update-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, newPassword: newPass, otp })
    });
    const data = await res.json();
    if (res.ok) {
      miniError.textContent = 'Password updated!';
      setTimeout(() => mini.remove(), 600);
    } else {
      miniError.textContent = data.message || 'Failed to update password.';
    }
  };
  // Forgot password link logic
  document.getElementById('mini-forgot').onclick = (e) => {
    e.preventDefault();
    mini.remove();
    if (typeof showForgotBox === 'function') showForgotBox();
    else if (window.forgotBox) {
      forgotBox.style.display = 'block';
      loginBox.style.display = 'none';
      signupBox.style.display = 'none';
      authContainer.style.display = 'block';
    }
  };
}

function handleLogout(){
  profileMenu.style.display='none';
  if(!currentUserId) return;
  fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:currentUserId})});
  localStorage.removeItem('currentUserId');
  currentUserId=null;
  updateAvatar();
  authContainer.style.display='block';
  chatContainer.style.display='none';
  signupBox.style.display='block';
  loginBox.style.display='none';
  if(socket) socket.disconnect();
}

function setDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
  localStorage.setItem('darkMode', enabled ? '1' : '0');
  let label = document.getElementById('dark-mode-label');
  if (enabled) {
    if (!label) {
      label = document.createElement('div');
      label.id = 'dark-mode-label';
      label.textContent = 'Dark Mode';
      label.style.position = 'fixed';
      label.style.top = '16px';
      label.style.right = '24px';
      label.style.background = '#222';
      label.style.color = '#fff';
      label.style.padding = '6px 18px';
      label.style.borderRadius = '16px';
      label.style.fontWeight = '600';
      label.style.fontSize = '1em';
      label.style.zIndex = '99999';
      label.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
      document.body.appendChild(label);
    }
  } else {
    if (label) label.remove();
  }
}

// Dark mode on load
if(localStorage.getItem('darkMode')==='1') setDarkMode(true);

// Delete Account Modal
function showDeleteAccountModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Delete Account</h2>
      <label>Email</label>
      <input type="email" value="${currentUserId || ''}" readonly style="margin-bottom:10px;">
      <label>Password</label>
      <input type="password" id="del-password" placeholder="Enter password" style="margin-bottom:6px;">
      <button id="del-otp-btn" style="width:100%;margin-bottom:6px;">Send OTP</button>
      <input type="text" id="del-otp" placeholder="Enter OTP" style="display:none;margin-bottom:6px;">
      <button id="del-confirm-btn" style="width:100%;display:none;">Delete Account</button>
      <div style="margin:8px 0 0 0;text-align:right;">
        <a href="#" id="del-forgot" style="color:#25d366;text-decoration:underline;font-size:0.98em;">Forgot password?</a>
      </div>
      <div id="del-error" class="error"></div>
      <button id="del-cancel" style="margin-top:14px;width:100%;background:#eee;color:#333;">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
  // Modal logic
  const delPassword = modal.querySelector('#del-password');
  const delOtpBtn = modal.querySelector('#del-otp-btn');
  const delOtp = modal.querySelector('#del-otp');
  const delConfirmBtn = modal.querySelector('#del-confirm-btn');
  const delError = modal.querySelector('#del-error');
  const delCancel = modal.querySelector('#del-cancel');
  const delForgot = modal.querySelector('#del-forgot');
  delOtpBtn.onclick = async () => {
    delError.textContent = '';
    if (!delPassword.value) {
      delError.textContent = 'Password required.';
      return;
    }
    const res = await fetch('/api/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUserId, password: delPassword.value, type: 'delete' })
    });
    const data = await res.json();
    if (!res.ok) {
      delError.textContent = data.message || 'Failed to send OTP.';
      return;
    }
    alert('Your OTP is: ' + data.otp); // Show OTP in alert for demo
    delOtp.style.display = 'block';
    delConfirmBtn.style.display = 'block';
    delOtpBtn.disabled = true;
    delError.textContent = 'Enter the OTP sent to your browser';
  };
  delConfirmBtn.onclick = async () => {
    delError.textContent = '';
    if (!delOtp.value) {
      delError.textContent = 'OTP required.';
      return;
    }
    const res = await fetch('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, password: delPassword.value, otp: delOtp.value })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Account deleted successfully.');
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } else {
      delError.textContent = data.message || 'Failed to delete account.';
    }
  };
  delCancel.onclick = () => modal.remove();
  delForgot.onclick = (e) => {
    e.preventDefault();
    modal.remove();
    forgotBox.style.display = 'block';
    loginBox.style.display = 'none';
    signupBox.style.display = 'none';
    authContainer.style.display = 'block';
  };
}

// --- Auto-login if userId exists in localStorage ---
const storedUserId = localStorage.getItem('currentUserId');
if (storedUserId) {
  currentUserId = storedUserId;
  updateAvatar();
  authContainer.style.display = 'none';
  chatContainer.style.display = 'block';
  initSocket(); // Always call, even if not in chat
  registerPush();
  fetchUsers();
} else {
  // Show signup page for new users
  authContainer.style.display = 'block';
  chatContainer.style.display = 'none';
  signupBox.style.display = 'block';
  loginBox.style.display = 'none';
}
// --------------------------------------------------

document.addEventListener('DOMContentLoaded', function() {
  // Auth box elements
  const signupBox = document.getElementById('signup-box');
  const loginBox = document.getElementById('login-box');
  const forgotBox = document.getElementById('forgot-box');
  const showLogin = document.getElementById('show-login');
  const showSignup = document.getElementById('show-signup');
  const showForgot = document.getElementById('show-forgot');
  const showLogin2 = document.getElementById('show-login2');
  // Signup
  const signupName = document.getElementById('signup-name');
  const signupEmail = document.getElementById('signup-email');
  const signupPassword = document.getElementById('signup-password');
  const signupOtpBtn = document.getElementById('signup-otp-btn');
  const signupOtp = document.getElementById('signup-otp');
  const signupBtn = document.getElementById('signup-btn');
  const signupError = document.getElementById('signup-error');
  // Login
  const loginName = document.getElementById('login-name');
  const loginPassword = document.getElementById('login-password');
  const loginOtpBtn = document.getElementById('login-otp-btn');
  const loginOtp = document.getElementById('login-otp');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  // Forgot
  const forgotEmail = document.getElementById('forgot-email');
  const forgotOtpBtn = document.getElementById('forgot-otp-btn');
  const forgotOtp = document.getElementById('forgot-otp');
  const forgotNewPassword = document.getElementById('forgot-new-password');
  const forgotResetBtn = document.getElementById('forgot-reset-btn');
  const forgotError = document.getElementById('forgot-error');

  // Helper to reset forgot password UI
  function resetForgotBoxUI() {
    forgotOtp.style.display = 'none';
    forgotNewPassword.style.display = 'none';
    forgotResetBtn.style.display = 'none';
    forgotOtpBtn.disabled = false;
    forgotEmail.value = '';
    forgotOtp.value = '';
    forgotNewPassword.value = '';
    forgotError.textContent = '';
  }

  // Switch between forms
  if (showLogin) showLogin.onclick = () => {
    signupBox.style.display = 'none';
    loginBox.style.display = 'block';
    forgotBox.style.display = 'none';
  };
  if (showSignup) showSignup.onclick = () => {
    loginBox.style.display = 'none';
    signupBox.style.display = 'block';
    forgotBox.style.display = 'none';
  };
  if (showForgot) showForgot.onclick = () => {
    signupBox.style.display = 'none';
    loginBox.style.display = 'none';
    forgotBox.style.display = 'block';
    resetForgotBoxUI();
    forgotEmail.style.display = 'block';
    forgotOtpBtn.style.display = 'inline-block';
  };
  if (showLogin2) showLogin2.onclick = () => {
    forgotBox.style.display = 'none';
    loginBox.style.display = 'block';
    resetForgotBoxUI();
  };

  // Signup OTP flow
  if (signupOtpBtn) signupOtpBtn.onclick = async () => {
    const name = signupName.value.trim();
    const email = signupEmail.value.trim();
    const password = signupPassword.value;
    if (!name || !email || !password) {
      signupError.textContent = 'All fields are required.';
      return;
    }
    const otpRes = await fetch('/api/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, type: 'signup' })
    });
    const otpData = await otpRes.json();
    if (!otpRes.ok) {
      signupError.textContent = otpData.message || 'Failed to request OTP.';
      return;
    }
    alert('Your OTP is: ' + otpData.otp); // Show OTP in alert for demo
    signupOtp.style.display = 'block';
    signupBtn.style.display = 'inline-block';
    signupOtpBtn.disabled = true;
    signupError.textContent = 'Enter the OTP sent to your browser: ' + email;
  };
  if (signupBtn) signupBtn.onclick = async () => {
    const name = signupName.value.trim();
    const email = signupEmail.value.trim();
    const password = signupPassword.value;
    const otp = signupOtp.value.trim();
    if (!name || !email || !password || !otp) {
      signupError.textContent = 'All fields are required.';
      return;
    }
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, otp })
    });
    const data = await res.json();
    if (res.ok) {
      signupError.textContent = '';
      currentUserId = email;
      localStorage.setItem('currentUserId', email);
      authContainer.style.display = 'none';
      chatContainer.style.display = 'block';
      updateAvatar();
      initSocket();
      registerPush();
      fetchUsers();
    } else {
      signupError.textContent = data.message || 'Signup failed.';
    }
  };

  // Login OTP flow
  if (loginOtpBtn) loginOtpBtn.onclick = async () => {
    const email = loginName.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      loginError.textContent = 'All fields are required.';
      return;
    }
    const otpRes = await fetch('/api/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, type: 'login' })
    });
    const otpData = await otpRes.json();
    if (!otpRes.ok) {
      loginError.textContent = otpData.message || 'Failed to request OTP.';
      return;
    }
    alert('Your OTP is: ' + otpData.otp); // Show OTP in alert for demo
    loginOtp.style.display = 'block';
    loginBtn.style.display = 'inline-block';
    loginOtpBtn.disabled = true;
    loginError.textContent = 'Enter the OTP sent to your email: ' + email;
  };
  if (loginBtn) loginBtn.onclick = async () => {
    const email = loginName.value.trim();
    const password = loginPassword.value;
    const otp = loginOtp.value.trim();
    if (!email || !password || !otp) {
      loginError.textContent = 'All fields are required.';
      return;
    }
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, otp })
    });
    const data = await res.json();
    if (res.ok) {
      loginError.textContent = '';
      currentUserId = email;
      localStorage.setItem('currentUserId', email); // Store email as ID
      authContainer.style.display = 'none';
      chatContainer.style.display = 'block';
      updateAvatar();
      initSocket();
      registerPush();
      fetchUsers();
    } else {
      loginError.textContent = data.message || 'Login failed.';
    }
  };

  // Forgot password flow
  if (forgotOtpBtn) forgotOtpBtn.onclick = async () => {
    const email = forgotEmail.value.trim();
    if (!email) {
      forgotError.textContent = 'Email is required.';
      return;
    }
    const otpRes = await fetch('/api/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, type: 'forgot' })
    });
    const otpData = await otpRes.json();
    if (!otpRes.ok) {
      forgotError.textContent = otpData.message || 'Failed to request OTP.';
      return;
    }
    alert('Your OTP is: ' + otpData.otp); // Show OTP in alert for demo
    forgotOtp.style.display = 'block';
    forgotNewPassword.style.display = 'block';
    forgotResetBtn.style.display = 'block';
    forgotOtpBtn.disabled = true;
    forgotOtp.value = '';
    forgotNewPassword.value = '';
    forgotError.textContent = 'Enter the OTP sent to your email.';
  };
  if (forgotResetBtn) forgotResetBtn.onclick = async () => {
    const email = forgotEmail.value.trim();
    const otp = forgotOtp.value.trim();
    const newPassword = forgotNewPassword.value;
    if (!email || !otp || !newPassword) {
      forgotError.textContent = 'All fields are required.';
      return;
    }
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Password reset successful! You can now login.');
      forgotBox.style.display = 'none';
      loginBox.style.display = 'block';
      resetForgotBoxUI();
    } else {
      forgotError.textContent = data.message || 'Failed to reset password.';
    }
  };

  // User search filter
  const userSearchInput = document.getElementById('user-search');
  if (userSearchInput) {
    userSearchInput.addEventListener('input', function() {
      const query = this.value.trim().toLowerCase();
      const userListData = JSON.parse(localStorage.getItem('userList') || '[]');
      const filtered = userListData.filter(u =>
        (u.name && u.name.toLowerCase().includes(query)) ||
        (u.userId && u.userId.toLowerCase().includes(query))
      );
      renderUserList(filtered);
    });
  }
});

// Fetch users
async function fetchUsers() {
  const res = await fetch('/api/online-users');
  const data = await res.json();
  userList.innerHTML = '';
  const onlineUserIds = data.online || [];
  localStorage.setItem('onlineUserIds', JSON.stringify(onlineUserIds));
  localStorage.setItem('userList', JSON.stringify(data.users));
  localStorage.setItem('lastSeen', JSON.stringify(data.lastSeen || {}));
  renderUserList(data.users, onlineUserIds, data.lastSeen || {});
}

function renderUserList(users, onlineUserIds, lastSeenObj) {
  userList.innerHTML = '';
  // Sort: current user first, then others
  const sortedUsers = [...users].sort((a, b) => {
    if (a.email === currentUserId) return -1;
    if (b.email === currentUserId) return 1;
    return 0;
  });
  sortedUsers.forEach(user => {
    const li = document.createElement('li');
    // Create avatar container
    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'avatar-container';
    // Create avatar circle
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.textContent = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();
    avatarContainer.appendChild(avatar);
    // Online/offline dot
    const dot = document.createElement('span');
    dot.className = 'online-dot';
    if (user.email === currentUserId) {
      dot.style.background = '#2563eb'; // Blue for self
    } else {
      dot.style.background = onlineUserIds.includes(user.email) ? '#25d366' : '#bbb';
    }
    avatarContainer.appendChild(dot);
    // Create name and id block
    const nameBlock = document.createElement('span');
    nameBlock.className = 'user-name-block';
    // Name first
    const nameRow = document.createElement('span');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = user.name || '';
    // If this is the current user, add (you)
    if (user.email === currentUserId) {
      const youSpan = document.createElement('span');
      youSpan.textContent = ' (you)';
      youSpan.style.color = '#888';
      nameSpan.appendChild(youSpan);
    }
    nameRow.appendChild(nameSpan);
    // 1px gap
    const gap = document.createElement('div');
    gap.style.height = '1px';
    // User ID with @
    const idSpan = document.createElement('span');
    idSpan.className = 'user-id';
    idSpan.textContent = '@' + user.email;
    nameBlock.appendChild(nameRow);
    nameBlock.appendChild(gap);
    nameBlock.appendChild(idSpan);
    // Online/last seen status
    const statusSpan = document.createElement('span');
    statusSpan.className = 'user-status';
    if (user.email !== currentUserId) {
      if (onlineUserIds.includes(user.email)) {
        statusSpan.textContent = 'Online';
        statusSpan.style.color = '#25d366';
      } else if (lastSeenObj && lastSeenObj[user.email]) {
        const ago = Math.floor((Date.now() - lastSeenObj[user.email]) / 1000);
        statusSpan.textContent = 'Last seen: ' + formatEnglishAgo(ago);
        statusSpan.style.color = '#888';
      } else {
        statusSpan.textContent = '';
      }
      nameBlock.appendChild(statusSpan);
    }
    // Compose
    li.appendChild(avatarContainer);
    li.appendChild(nameBlock);
    li.onclick = () => {
      sessionStorage.setItem('chatTarget', user.email);
      window.open('chat.html?userId=' + encodeURIComponent(user.email), '_blank');
    };
    userList.appendChild(li);
  });
}

// Refresh user list every 5 seconds
setInterval(() => {
  if (currentUserId) fetchUsers();
}, 5000);

// === Local chat history helpers ===
function historyKey(uid, peer) {
  return `chat_history_${uid}_${peer}`;
}
function saveToHistory(entry) {
  const key = historyKey(entry.from, entry.to);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  arr.push(entry);
  localStorage.setItem(key, JSON.stringify(arr));
}
function loadHistory(uid, peer) {
  const key = historyKey(uid, peer);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key)) || []; } catch {}
  arr.forEach(it => addMessage(it.message, it.from === uid ? 'me' : 'them'));
}
// ----------------------------------

function initSocket() {
  socket = io();
  socket.emit('join', currentUserId);
  // Text messages
  socket.on('receive_message', ({ from, message, to, time }) => {
    const activeChats = JSON.parse(localStorage.getItem('activeChats') || '[]');
    // Only show alert if there is no active chat window for this sender
    if (from !== currentUserId && !activeChats.includes(from)) {
      alert(`New message from ${from}: ${message}`);
      incrementUnreadCount(from);
      renderAllUsersDashboard(); // Update badge
    }
    // persist
    saveToHistory({ from, to: currentUserId, message, time: time || Date.now(), type: 'text' });
  });

  // Voice messages
  socket.on('receive_voice', ({ from, audioType, dataUrl, id, to, time }) => {
    const activeChats = JSON.parse(localStorage.getItem('activeChats') || '[]');
    if (from !== currentUserId && !activeChats.includes(from)) {
      alert(`New voice message from ${from}`);
    }
    saveToHistory({ from, to: currentUserId, audioType, dataUrl, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: time || Date.now(), type: 'voice' });
  });
}

function startChat(userId) {
  chattingWith = userId;
  chatWith.textContent = `Chatting with ${userId}`;
  chatBox.style.display = 'block';
  messagesDiv.innerHTML = '';
  setUnreadCount(userId, 0);
  renderAllUsersDashboard();
  loadHistory(currentUserId, chattingWith);
  // Always scroll to bottom after loading
  setTimeout(() => { messagesDiv.scrollTop = messagesDiv.scrollHeight; }, 100);
}

sendBtn.onclick = () => {
  const msg = messageInput.value.trim();
  if (!msg || !chattingWith) return;
  addMessage(msg, 'me');
  saveToHistory({ from: currentUserId, to: chattingWith, message: msg, time: Date.now(), type: 'text' });
  socket.emit('send_message', { to: chattingWith, from: currentUserId, message: msg });
  messageInput.value = '';
};

function addMessage(msg, who) {
  const div = document.createElement('div');
  div.className = 'message ' + who;
  div.textContent = msg;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

closeChatBtn.onclick = () => {
  chatBox.style.display = 'none';
  chattingWith = null;
  chatWith.textContent = '';
};

async function fetchAllUsers() {
  const res = await fetch('/api/all-users');
  const data = await res.json();
  return data.users;
}

async function renderAllUsersDashboard() {
  const allUsers = await fetchAllUsers();
  const onlineUserIds = JSON.parse(localStorage.getItem('onlineUserIds') || '[]');
  const userList = document.getElementById('user-list');
  const offlineUserList = document.getElementById('offline-user-list');
  userList.innerHTML = '';
  offlineUserList.innerHTML = '';
  allUsers.forEach(user => {
    const li = document.createElement('li');
    // Avatar
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.textContent = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();
    li.appendChild(avatar);
    // Name & blue tick
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = user.name || '';
    if (verifiedEmails.includes(user.email)) {
      const tick = document.createElement('img');
      tick.src = 'https://cdn-icons-png.flaticon.com/512/11708/11708440.png';
      tick.alt = 'verified';
      tick.style.width = '20px';
      tick.style.height = '20px';
      tick.style.marginLeft = '6px';
      tick.style.verticalAlign = 'middle';
      nameSpan.appendChild(tick);
    }
    li.appendChild(nameSpan);
    // Unread badge
    const unread = getUnreadCount(user.email);
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = unread;
      badge.style.background = '#e74c3c';
      badge.style.color = '#fff';
      badge.style.borderRadius = '12px';
      badge.style.padding = '2px 8px';
      badge.style.marginLeft = '8px';
      badge.style.fontSize = '0.9em';
      badge.style.fontWeight = 'bold';
      li.appendChild(badge);
    }
    // Email
    const idSpan = document.createElement('span');
    idSpan.className = 'user-id';
    idSpan.textContent = '@' + user.email;
    li.appendChild(idSpan);
    // Online/offline dot
    const dot = document.createElement('span');
    dot.className = 'online-dot';
    if (onlineUserIds.includes(user.email)) {
      dot.style.background = '#25d366';
      li.appendChild(dot);
      userList.appendChild(li);
    } else {
      dot.style.background = '#bbb';
      li.appendChild(dot);
      offlineUserList.appendChild(li);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderAllUsersDashboard();
  // User search filter for all users
  const userSearchInput = document.getElementById('user-search');
  if (userSearchInput) {
    userSearchInput.addEventListener('input', async function() {
      const query = this.value.trim().toLowerCase();
      const allUsers = await fetchAllUsers();
      const filtered = allUsers.filter(u =>
        (u.name && u.name.toLowerCase().includes(query)) ||
        (u.email && u.email.toLowerCase().includes(query))
      );
      const onlineUserIds = JSON.parse(localStorage.getItem('onlineUserIds') || '[]');
      const userList = document.getElementById('user-list');
      const offlineUserList = document.getElementById('offline-user-list');
      userList.innerHTML = '';
      offlineUserList.innerHTML = '';
      filtered.forEach(user => {
        const li = document.createElement('li');
        const avatar = document.createElement('span');
        avatar.className = 'user-avatar';
        avatar.textContent = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase();
        li.appendChild(avatar);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = user.name || '';
        if (verifiedEmails.includes(user.email)) {
          const tick = document.createElement('img');
          tick.src = 'https://cdn-icons-png.flaticon.com/512/11708/11708440.png';
          tick.alt = 'verified';
          tick.style.width = '20px';
          tick.style.height = '20px';
          tick.style.marginLeft = '6px';
          tick.style.verticalAlign = 'middle';
          nameSpan.appendChild(tick);
        }
        li.appendChild(nameSpan);
        const idSpan = document.createElement('span');
        idSpan.className = 'user-id';
        idSpan.textContent = '@' + user.email;
        li.appendChild(idSpan);
        const dot = document.createElement('span');
        dot.className = 'online-dot';
        if (onlineUserIds.includes(user.email)) {
          dot.style.background = '#25d366';
          li.appendChild(dot);
          userList.appendChild(li);
        } else {
          dot.style.background = '#bbb';
          li.appendChild(dot);
          offlineUserList.appendChild(li);
        }
      });
    });
  }
});

// Verified emails for blue tick
const verifiedEmails = [
  'dbaidya811@gmail.com',
  'baidyachandan787@gmail.com'
];

function formatEnglishAgo(seconds) {
  if (seconds < 60) return seconds + ' seconds ago';
  if (seconds < 3600) return Math.floor(seconds/60) + ' minutes ago';
  if (seconds < 86400) return Math.floor(seconds/3600) + ' hours ago';
  return Math.floor(seconds/86400) + ' days ago';
}
// --- Call Notification Sound ---
const callSound = new Audio('/notification.mp3'); // Place notification.mp3 in public/

function showCallNotification(type, from, offer) {
  // Play notification sound
  callSound.play().catch(()=>{});
  // Show a simple confirm popup (replace with custom modal if needed)
  if(confirm(`${from} is ${type === 'video' ? 'video calling' : 'calling'} you. Open chat?`)){
    window.open(`chat.html?userId=${from}`, '_blank');
  }
}

// Listen for incoming call events globally
if (typeof socket !== 'undefined') {
  socket.on('incoming_call', ({from, offer}) => {
    showCallNotification('voice', from, offer);
  });
  socket.on('incoming_video', ({from, offer}) => {
    showCallNotification('video', from, offer);
  });
}

// Ensure #messages is always scrollable
messagesDiv.style.overflowY = 'auto';
messagesDiv.style.height = '100%';

