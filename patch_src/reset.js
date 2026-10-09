// ===== 忘记密码（改密码） =====
// 背景：密码在本地和云端都只以 SHA-256 哈希保存，不可逆，所以「找回原密码」在物理上做不到。
// 能做的是「重设」：拿昵称 + 新密码直接改掉云端账号表那条记录里的 密码哈希。
//
// 为什么需要它：正常登录走 doLogin()，密码哈希对不上就报「密码错误」直接 return，
// 没有任何改密入口。账号是用户自设的轻量标识（不是邮箱/手机号），没有验证码可发，
// 所以这个重设流程只以「你记得昵称」为凭据 —— 这是账号机制的固有取舍，不是可以绕过的缺陷。
//
// 同时把本机 localStorage 里的记录也改掉，这样换设备后仍能登录。

var RESET_FIELDS_ON = false;

function toggleResetForm() {
  var lf = document.getElementById('loginForm');
  var rf = document.getElementById('resetForm');
  if (!lf || !rf) return;
  // 用显式标记判断当前状态，不要靠 display 的空串/none 反复推断
  var isOpen = rf.__open === true;
  if (isOpen) {
    lf.style.display = '';
    rf.style.display = 'none';
    rf.__open = false;
  } else {
    lf.style.display = 'none';
    rf.style.display = '';
    rf.__open = true;
  }
  var e = document.getElementById('resetErr');
  if (e) e.textContent = '';
  if (!isOpen) {
    var n = document.getElementById('loginNick');
    var rn = document.getElementById('resetNick');
    if (rn && n && n.value) rn.value = n.value;
  }
}

// 把本机 users 里该昵称的密码哈希同步改掉（没有这条也没关系，登录时以云端为准，
// 但改了能避免下次云端不可达时因为本地哈希不一致而进不去）
function updateLocalPassHash(nick, hash, profileId) {
  try {
    var users = LS.get('users', []);
    var hit = false;
    for (var i = 0; i < users.length; i++) {
      if (users[i].nick === nick) {
        users[i].passHash = hash;
        if (profileId) users[i].profileId = profileId;
        hit = true;
        break;
      }
    }
    if (!hit) users.push({ nick: nick, passHash: hash, profileId: profileId || '', createdAt: nowISO() });
    LS.set('users', users);
    return hit;
  } catch (e) {
    console.warn('updateLocalPassHash failed', e);
    return false;
  }
}

function doResetPassword() {
  var nick = document.getElementById('resetNick').value.trim();
  var p1 = document.getElementById('resetPass1').value;
  var p2 = document.getElementById('resetPass2').value;
  var err = document.getElementById('resetErr');
  err.textContent = '';
  if (!nick) { err.textContent = '请输入昵称'; return; }
  if (!p1 || p1.length < 6) { err.textContent = '新密码至少 6 位'; return; }
  if (p1 !== p2) { err.textContent = '两次输入的密码不一致'; return; }

  var btn = document.getElementById('resetBtn');
  if (btn) btn.disabled = true;
  err.textContent = '正在重设…';

  sha256(p1).then(function(hash) {
    CLOUD.waitReady(8000).then(function(cloudOk) {
      if (!cloudOk) { if (btn) btn.disabled = false; err.textContent = '连不上云端，请检查网络后重试'; return; }
      queryCloudUserByNick(nick).then(function(row) {
        // 云端没这条记录 → 不是重设密码的场景，交给注册/找回流程
        if (!row) {
          if (btn) btn.disabled = false;
          err.textContent = '云端没有「' + nick + '」这个账号。请确认昵称是否写对，或直接去注册。';
          return;
        }
        var pid = row['profile_id'] || '';
        var props = {
          '密码哈希': { text: hash },
          '更新时间': { date: nowISO() },
          '最后同步': { date: nowISO() }
        };
        CLOUD.update(DB_IDS.context_users, row._id, props).then(function() {
          STATE.cloudUserId = row._id;
          updateLocalPassHash(nick, hash, pid);
          // 直接登录进去，不用再让用户手输一遍
          finalizeLogin(nick, hash, pid, null, '密码已重设，已自动登录');
          return null;
        }).catch(function(e) {
          if (btn) btn.disabled = false;
          console.warn('reset failed', e);
          err.textContent = '重设失败：云端没有返回成功。请稍后再试一次。';
        });
        return null;
      });
    });
  }).catch(function() {
    if (btn) btn.disabled = false;
    err.textContent = '重设失败，请稍后再试';
  });
}