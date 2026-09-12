const possibleEmojis = [
  '🐀','🐁','🐭','🐹','🐂','🐃','🐄','🐮','🐅','🐆','🐯','🐇','🐐','🐑','🐏','🐴',
  '🐎','🐱','🐈','🐰','🐓','🐔','🐤','🐣','🐥','🐦','🐧','🐘','🐩','🐕','🐷','🐖',
  '🐗','🐫','🐪','🐶','🐺','🐻','🐨','🐼','🐵','🙈','🙉','🙊','🐒','🐉','🐲','🐊',
  '🐍','🐢','🐸','🐋','🐳','🐬','🐙','🐟','🐠','🐡','🐚','🐌','🐛','🐜','🐝','🐞',
];

function randomEmoji() {
  var randomIndex = Math.floor(Math.random() * possibleEmojis.length);
  return possibleEmojis[randomIndex];
}

// ===== حفظ الاسم والإيموجي في localStorage =====
let name = localStorage.getItem('chat_name');
let emoji = localStorage.getItem('chat_emoji');

if (!name) {
  name = prompt("What's your name?") || 'Guest';
  emoji = randomEmoji();
  localStorage.setItem('chat_name', name);
  localStorage.setItem('chat_emoji', emoji);
}

// Generate random chat hash if needed
if (!location.hash) {
  location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
}
const chatHash = location.hash.substring(1);

// TODO: Replace with your own channel ID
const drone = new ScaleDrone('yiS12Ts5RdNhebyM');
const roomName = 'observable-' + chatHash;
let room;

const configuration = {
  iceServers: [{
    url: 'stun:stun.l.google.com:19302'
  }]
};
let pc;
let dataChannel;

// عناصر DOM
const messagesEl = document.querySelector('.messages');
const statusEl = document.querySelector('.chat-header__status');

drone.on('open', error => {
  if (error) return console.error(error);
  room = drone.subscribe(roomName);
  room.on('open', error => {
    if (error) return console.error(error);
    console.log('Connected to signaling server');
  });

  room.on('members', members => {
    if (members.length >= 3) {
      return alert('The room is full');
    }
    const isOfferer = members.length === 2;
    startWebRTC(isOfferer);
  });

  // ===== إشعار عند اتصال / انقطاع الطرف الآخر =====
  room.on('member_join', member => {
    if (member.id !== drone.clientId) {
      showStatus('متصل');
      insertSystemMessage('🟢 المستخدم الآخر متصل الآن');
    }
  });

  room.on('member_leave', member => {
    if (member.id !== drone.clientId) {
      showStatus('غير متصل');
      insertSystemMessage('🔴 المستخدم الآخر غادر المحادثة');
    }
  });
});

function sendSignalingMessage(message) {
  drone.publish({ room: roomName, message });
}

function startWebRTC(isOfferer) {
  console.log('Starting WebRTC in as', isOfferer ? 'offerer' : 'waiter');
  pc = new RTCPeerConnection(configuration);

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendSignalingMessage({'candidate': event.candidate});
    }
  };

  if (isOfferer) {
    pc.onnegotiationneeded = () => {
      pc.createOffer(localDescCreated, error => console.error(error));
    }
    dataChannel = pc.createDataChannel('chat');
    setupDataChannel();
  } else {
    pc.ondatachannel = event => {
      dataChannel = event.channel;
      setupDataChannel();
    }
  }

  startListentingToSignals();
}

function startListentingToSignals() {
  room.on('data', (message, client) => {
    if (client.id === drone.clientId) return;
    if (message.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(message.sdp), () => {
        if (pc.remoteDescription.type === 'offer') {
          pc.createAnswer(localDescCreated, error => console.error(error));
        }
      }, error => console.error(error));
    } else if (message.candidate) {
      pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
  });
}

function localDescCreated(desc) {
  pc.setLocalDescription(
    desc,
    () => sendSignalingMessage({'sdp': pc.localDescription}),
    error => console.error(error)
  );
}

function setupDataChannel() {
  checkDataChannelState();
  dataChannel.onopen = checkDataChannelState;
  dataChannel.onclose = checkDataChannelState;
  dataChannel.onmessage = event =>
    insertMessageToDOM(JSON.parse(event.data), false)
}

function checkDataChannelState() {
  console.log('WebRTC channel state is:', dataChannel.readyState);
  if (dataChannel.readyState === 'open') {
    showStatus('متصل');
  } else if (dataChannel.readyState === 'closed') {
    showStatus('غير متصل');
  }
}

// ===== إظهار/تحديث حالة الاتصال =====
function showStatus(text) {
  if (statusEl) statusEl.innerText = text;
}

// ===== رسائل النظام (مثل: متصل/غير متصل) =====
function insertSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.innerText = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ===== عرض الوقت الحالي =====
function getCurrentTime() {
  const d = new Date();
  let h = d.getHours();
  let m = d.getMinutes();
  const ampm = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  m = m < 10 ? '0' + m : m;
  return `${h}:${m} ${ampm}`;
}

function insertMessageToDOM(options, isFromMe) {
  const template = document.querySelector('template[data-template="message"]');
  const nameEl = template.content.querySelector('.message__name');
  const timeEl = template.content.querySelector('.message__time');

  if (options.emoji || options.name) {
    nameEl.innerText = options.emoji + ' ' + options.name;
  }
  template.content.querySelector('.message__bubble').innerText = options.content;
  if (timeEl) timeEl.innerText = getCurrentTime();

  const clone = document.importNode(template.content, true);
  const messageEl = clone.querySelector('.message');
  if (isFromMe) {
    messageEl.classList.add('message--mine');
  } else {
    messageEl.classList.add('message--theirs');
  }

  messagesEl.appendChild(clone);
  messagesEl.scrollTop = messagesEl.scrollHeight - messagesEl.clientHeight;
}

const form = document.querySelector('form');
form.addEventListener('submit', () => {
  const input = document.querySelector('input[type="text"]');
  const value = input.value.trim();
  if (!value) return;
  input.value = '';

  if (!dataChannel || dataChannel.readyState !== 'open') {
    insertSystemMessage('⚠️ لا يمكن إرسال الرسالة، الطرف الآخر غير متصل');
    return;
  }

  const data = { name, content: value, emoji };

  dataChannel.send(JSON.stringify(data));
  insertMessageToDOM(data, true);
});

// لا نضيف رسالة "Chat URL" بعد الآن