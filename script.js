// ================================
// الإيموجي
// ================================
const possibleEmojis = [
  '🐀','🐁','🐭','🐹','🐂','🐃','🐄','🐮','🐅','🐆','🐯','🐇',
  '🐐','🐑','🐏','🐴','🐎','🐱','🐈','🐰','🐓','🐔','🐤','🐣',
  '🐥','🐦','🐧','🐘','🐩','🐕','🐷','🐖','🐗','🐫','🐪','🐶',
  '🐺','🐻','🐨','🐼','🐵','🙈','🙉','🙊','🐒','🐉','🐲','🐊',
  '🐍','🐢','🐸','🐋','🐳','🐬','🐙','🐟','🐠','🐡','🐚','🐌',
  '🐛','🐜','🐝','🐞'
];

function randomEmoji() {
  return possibleEmojis[
    Math.floor(Math.random() * possibleEmojis.length)
  ];
}

// ================================
// الاسم والإيموجي (يُحفظ مرة واحدة للأبد)
// ================================
let name = localStorage.getItem('chat_name');
let emoji = localStorage.getItem('chat_emoji');

if (!name) {
  name = prompt("What's your name?") || 'Guest';
  emoji = randomEmoji();
  localStorage.setItem('chat_name', name);
  localStorage.setItem('chat_emoji', emoji);
}

// ================================
// نظام الغرفة (لا يتغير أبدًا)
// ================================
if (!location.hash) {
  location.hash = Math.floor(Math.random() * 0xFFFFFF)
    .toString(16);
}

const chatHash = location.hash.substring(1);
const roomName = 'observable-' + chatHash;

// ================================
// عناصر الصفحة
// ================================
const messagesEl = document.querySelector('.messages');
const statusEl = document.querySelector('.chat-header__status');
const inputEl = document.querySelector('input[type="text"]');
const form = document.querySelector('form');

// ================================
// الحالة العامة
// ================================
let drone = null;
let room = null;
let pc = null;
let dataChannel = null;

let isConnected = false;
let webRTCStarted = false;
let signalingStarted = false;
let pendingCandidates = [];
let dataHandlerBound = false;

// ================================
// إعدادات WebRTC
// ================================
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ============================================================
//                        بدء التشغيل
// ============================================================
function initDrone() {
  console.log('🚀 بدء تشغيل ScaleDrone');

  drone = new ScaleDrone('yiS12Ts5RdNhebyM');

  drone.on('open', onDroneOpen);
  drone.on('close', onDroneClose);
  drone.on('error', onDroneError);
}

function onDroneOpen(error) {
  if (error) {
    console.error('❌ ScaleDrone open error:', error);
    showStatus('خطأ في الاتصال');
    // إعادة المحاولة بعد 3 ثوان
    setTimeout(initDrone, 3000);
    return;
  }

  console.log('✅ ScaleDrone متصل');

  subscribeToRoom();
}

function onDroneClose() {
  console.warn('⚠️ ScaleDrone انقطع — إعادة الاتصال...');
  showStatus('جارٍ إعادة الاتصال...');

  cleanupConnection();
  cleanupRoom();

  // إعادة المحاولة بعد ثانيتين
  setTimeout(initDrone, 2000);
}

function onDroneError(error) {
  console.error('❌ ScaleDrone error:', error);
}

// ============================================================
//                     الاشتراك في الغرفة
// ============================================================
function subscribeToRoom() {
  console.log('📡 الاشتراك في:', roomName);

  room = drone.subscribe(roomName);

  // ملاحظة: عند إنشاء room جديد بعد إعادة الاتصال
  // نعيد ربط كل الـ handlers
  room.on('open', onRoomOpen);
  room.on('members', onMembersUpdate);
  room.on('member_join', onMemberJoin);
  room.on('member_leave', onMemberLeave);

  // بيانات signaling
  room.on('data', onSignalingData);
}

function onRoomOpen(error) {
  if (error) {
    console.error('❌ Room open error:', error);
    showStatus('خطأ في الغرفة');
    return;
  }

  console.log('✅ الغرفة جاهزة');
  showStatus('في انتظار المستخدم الآخر...');
}

// ============================================================
//                     الأعضاء
// ============================================================
function onMembersUpdate(members) {
  console.log('👥 عدد الموجودين:', members.length);

  if (members.length > 2) {
    alert('الغرفة ممتلئة');
    return;
  }

  if (members.length === 2 && !webRTCStarted) {
    // ترتيب أبجدي ثابت — يضمن اتفاق الطرفين
    const sortedIds = members.map(m => m.id).sort();
    const isOfferer = sortedIds[0] === drone.clientId;

    console.log('🆔 أنا:', drone.clientId);
    console.log('📋 مرتبين:', sortedIds);
    console.log('🎭 هل أنا Offerer؟', isOfferer);

    startWebRTC(isOfferer);
  }
}

function onMemberJoin(member) {
  if (member.id === drone.clientId) return;
  console.log('➕ عضو جديد:', member.id);
  showStatus('جارٍ الاتصال...');
}

function onMemberLeave(member) {
  if (member.id === drone.clientId) return;

  console.log('➖ عضو غادر:', member.id);

  // الطرف الآخر غادر → نظّف كل شيء
  cleanupConnection();
  cleanupRoom();

  showStatus('غير متصل');
  insertSystemMessage('🔴 المستخدم الآخر غادر المحادثة');

  // أعد الاشتراك لاستقبال الطرف الآخر إذا عاد
  setTimeout(() => {
    if (drone && drone.connection) {
      subscribeToRoom();
    }
  }, 500);
}

// ============================================================
//                    WebRTC — البدء
// ============================================================
function startWebRTC(isOfferer) {
  if (webRTCStarted) return;
  webRTCStarted = true;

  console.log('🎬 بدء WebRTC —',
    isOfferer ? 'OFFERER' : 'ANSWERER');

  try {
    pc = new RTCPeerConnection(configuration);
  } catch (e) {
    console.error('❌ فشل إنشاء RTCPeerConnection:', e);
    webRTCStarted = false;
    return;
  }

  // ICE candidates
  pc.onicecandidate = event => {
    if (event.candidate) {
      sendSignalingMessage({ candidate: event.candidate });
    }
  };

  // حالة الاتصال
  pc.onconnectionstatechange = () => {
    console.log('🔄 WebRTC:', pc.connectionState);

    switch (pc.connectionState) {
      case 'connecting':
        showStatus('جارٍ الاتصال...');
        break;
      case 'connected':
        setConnected(true);
        break;
      case 'disconnected':
      case 'failed':
      case 'closed':
        setConnected(false);
        break;
    }
  };

  // الطرف الأول — ينشئ DataChannel ويرسل Offer
  if (isOfferer) {
    try {
      dataChannel = pc.createDataChannel('chat');
      setupDataChannel();
    } catch (e) {
      console.error('❌ فشل إنشاء DataChannel:', e);
    }

    pc.onnegotiationneeded = async () => {
      try {
        console.log('📤 إنشاء Offer');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalingMessage({ sdp: pc.localDescription });
      } catch (error) {
        console.error('❌ Offer error:', error);
      }
    };
  }
  // الطرف الثاني — ينتظر DataChannel
  else {
    pc.ondatachannel = event => {
      console.log('📥 DataChannel وصل');
      dataChannel = event.channel;
      setupDataChannel();
    };
  }
}

// ============================================================
//                    Signaling
// ============================================================
function sendSignalingMessage(message) {
  if (!room || !drone) return;

  try {
    drone.publish({ room: roomName, message });
  } catch (e) {
    console.error('❌ فشل الإرسال:', e);
  }
}

async function onSignalingData(message, client) {
  // تجاهل رسائلنا
  if (client.id === drone.clientId) return;
  if (!pc) return;

  // SDP
  if (message.sdp) {
    try {
      console.log('📨 استقبال SDP:', message.sdp.type);

      // لو الحالة ليست stable — تجاهل
      if (pc.signalingState === 'closed') return;

      await pc.setRemoteDescription(
        new RTCSessionDescription(message.sdp)
      );

      // لو Offer → أنشئ Answer
      if (message.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        console.log('📤 إرسال Answer');
        sendSignalingMessage({ sdp: pc.localDescription });

        // طبّق ICE المؤجلة
        await addPendingCandidates();
      }

      // لو Answer → طبّق ICE المؤجلة أيضًا
      if (message.sdp.type === 'answer') {
        await addPendingCandidates();
      }
    } catch (error) {
      console.error('❌ SDP error:', error);
    }
    return;
  }

  // ICE Candidate
  if (message.candidate) {
    try {
      // لو ما زال لا يوجد remoteDescription — أخّر
      if (!pc.remoteDescription) {
        pendingCandidates.push(message.candidate);
        return;
      }

      await pc.addIceCandidate(
        new RTCIceCandidate(message.candidate)
      );
    } catch (error) {
      // أحيانًا يفشل لأن الاتصال أُغلق — لا مشكلة
      console.warn('⚠️ ICE error (تم تجاهله):', error.message);
    }
  }
}

async function addPendingCandidates() {
  if (!pc || !pc.remoteDescription) return;
  if (pendingCandidates.length === 0) return;

  console.log('🧊 إضافة ICE مؤجلة:', pendingCandidates.length);

  const candidates = [...pendingCandidates];
  pendingCandidates = [];

  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (error) {
      console.warn('⚠️ فشل إضافة ICE مؤجل:', error.message);
    }
  }
}

// ============================================================
//                    DataChannel
// ============================================================
function setupDataChannel() {
  if (!dataChannel) return;

  dataChannel.onopen = () => {
    console.log('✅✅ DataChannel OPEN ✅✅');
    setConnected(true);
  };

  dataChannel.onclose = () => {
    console.log('❌ DataChannel CLOSED');
    setConnected(false);
  };

  dataChannel.onerror = error => {
    console.error('❌ DataChannel error:', error);
  };

  dataChannel.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      insertMessageToDOM(data, false);
    } catch (error) {
      console.error('❌ خطأ في قراءة الرسالة:', error);
    }
  };
}

// ============================================================
//                    حالة الاتصال
// ============================================================
function setConnected(state) {
  if (isConnected === state) return;
  isConnected = state;

  if (state) {
    showStatus('متصل الآن');
    insertSystemMessage('🟢 المستخدم الآخر متصل الآن');
  } else {
    showStatus('غير متصل');
    insertSystemMessage('🔴 المستخدم الآخر غير متصل');
  }
}

function showStatus(text) {
  if (statusEl) statusEl.innerText = text;
}

function insertSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.innerText = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ============================================================
//                    التنظيف الشامل
// ============================================================
function cleanupConnection() {
  console.log('🧹 تنظيف الاتصال');

  // DataChannel
  if (dataChannel) {
    try {
      dataChannel.onopen = null;
      dataChannel.onclose = null;
      dataChannel.onerror = null;
      dataChannel.onmessage = null;
      dataChannel.close();
    } catch (e) {}
    dataChannel = null;
  }

  // PeerConnection
  if (pc) {
    try {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.onnegotiationneeded = null;
      pc.ondatachannel = null;
      pc.close();
    } catch (e) {}
    pc = null;
  }

  pendingCandidates = [];
  webRTCStarted = false;
  isConnected = false;
}

function cleanupRoom() {
  console.log('🧹 تنظيف الغرفة');

  if (room) {
    try {
      room.off('open');
      room.off('members');
      room.off('member_join');
      room.off('member_leave');
      room.off('data');
    } catch (e) {}
    room = null;
  }

  signalingStarted = false;
}

// ============================================================
//                    الوقت
// ============================================================
function getCurrentTime() {
  const d = new Date();
  let h = d.getHours();
  let m = d.getMinutes();
  const ampm = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  m = m < 10 ? '0' + m : m;
  return `${h}:${m} ${ampm}`;
}

// ============================================================
//                    عرض الرسالة
// ============================================================
function insertMessageToDOM(options, isFromMe) {
  const template = document.querySelector(
    'template[data-template="message"]'
  );

  const clone = document.importNode(template.content, true);

  const messageEl = clone.querySelector('.message');
  const nameEl = clone.querySelector('.message__name');
  const bubbleEl = clone.querySelector('.message__bubble');
  const timeEl = clone.querySelector('.message__time');

  nameEl.innerText =
    `${options.emoji || '👤'} ${options.name || ''}`;

  bubbleEl.innerText = options.content || '';
  timeEl.innerText = getCurrentTime();

  messageEl.classList.add(
    isFromMe ? 'message--mine' : 'message--theirs'
  );

  messagesEl.appendChild(clone);

  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ============================================================
//                    إرسال الرسالة
// ============================================================
form.addEventListener('submit', event => {
  event.preventDefault();

  const value = inputEl.value.trim();
  if (!value) return;

  // تحقق من الاتصال
  if (!dataChannel || dataChannel.readyState !== 'open') {
    insertSystemMessage('⚠️ المستخدم الآخر غير متصل حاليًا');
    return;
  }

  const data = { name, emoji, content: value };

  try {
    dataChannel.send(JSON.stringify(data));
    insertMessageToDOM(data, true);
    inputEl.value = '';
    inputEl.focus();
  } catch (error) {
    console.error('❌ فشل الإرسال:', error);
    insertSystemMessage('⚠️ تعذّر إرسال الرسالة');
  }
});

// ============================================================
//                    إغلاق التاب
// ============================================================
window.addEventListener('beforeunload', () => {
  console.log('🚪 إغلاق الصفحة — تنظيف');
  cleanupConnection();
  cleanupRoom();
});

// ============================================================
//                    التشغيل
// ============================================================
initDrone();