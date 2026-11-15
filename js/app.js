/* =========================================================================
   Quản lý công trình — giao diện (GitHub Pages), máy chủ là Apps Script (js/config.js).
   Toàn bộ dữ liệu nạp một lần qua apiLoad(); mọi thống kê tính tại đây cho
   nhanh, chỉ khi thêm/sửa/xóa mới gọi ngược lên server.
   Công thức và cách tính giữ nguyên như bản desktop Python.
   ========================================================================= */

var DB = { partners: [], projects: [], advances: [], floors: [], settings: {} };
var TODAY = '';
var RANGE = null;                 // [dfrom, dto] hoặc null = toàn bộ
var SEL = {};                     // id đang chọn của từng bảng
var DEBT_SEL = [];                // công nợ cho chọn nhiều dòng
var SORT = {};                    // trạng thái sắp xếp từng bảng
var AREA_ROWS = [];               // bảng tính diện tích dùng riêng
var TOKEN = '';                   // mã phiên đăng nhập — gửi kèm mọi lệnh gọi server
var ME = null;                    // { username, name, title, role: 'admin'|'staff', owner }
var ARISING_OK = {};              // { project_id: tổng phát sinh đã duyệt }
var VERSION = '2026.11.15-9';     // đặt trùng CACHE trong sw.js và APP_VER trong Code.gs
var SERVER_ON = typeof APP_URL === 'string' && /^https:\/\/script\.google\.com\/.+\/exec$/.test(APP_URL)
                && APP_URL.indexOf('DAN_MA') < 0;
// Ghi nhớ đăng nhập 60 ngày trên máy này (token do máy chủ ký, hết hạn tự đăng nhập lại).
function lsGet(k){ try { return localStorage.getItem('qlct.' + k) || ''; } catch (e) { return ''; } }
function lsSet(k, v){ try { if (v) localStorage.setItem('qlct.' + k, v); else localStorage.removeItem('qlct.' + k); } catch (e) {} }
TOKEN = lsGet('token');

function isAdmin(){ return !!ME && ME.role === 'admin'; }

var DONUT_COLORS = ['#1F78E0','#22B573','#8E5BE8','#FF9F43','#EF476F','#0E9AA7',
                    '#C9930B','#4C6EF5','#D6529E','#6E9E00','#A6621F','#5C7A99'];

/* ==================================================== TIỆN ÍCH SỐ / NGÀY */

function num(v){ var n = Number(v); return isNaN(n) || v === '' || v === null ? 0 : n; }

function money(v){ return Math.round(num(v)).toLocaleString('de-DE') + ' đ'; }

function moneyPlain(v){ return Math.round(num(v)).toLocaleString('de-DE'); }

/** Đọc số người dùng gõ, chịu được '1320.5', '1320,5' và '1.320,5'. */
function docSo(s){
  s = String(s === null || s === undefined ? '' : s).trim().replace(/\s/g,'');
  if (!s) return 0;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g,'').replace(',','.');
  else s = s.replace(',','.');
  return num(s);
}

/** Diện tích kiểu Việt Nam: 1.320,5 */
function dienTichVn(v){
  var parts = num(v).toFixed(2).split('.');
  var nguyen = Number(parts[0]).toLocaleString('de-DE');
  var le = parts[1].replace(/0+$/,'');
  return le ? nguyen + ',' + le : nguyen;
}

function heSoVn(v){
  var s = num(v).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  return s.replace('.', ',');
}

function shortMoney(v){
  var a = Math.abs(num(v));
  if (a >= 1e9) return (num(v)/1e9).toFixed(1).replace(/\.0$/,'') + ' tỷ';
  if (a >= 1e6) return Math.round(num(v)/1e6) + ' tr';
  if (a >= 1e3) return Math.round(num(v)/1e3) + ' K';
  return String(Math.round(num(v)));
}

function vn(iso){
  if (!iso) return '';
  var s = String(iso).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.slice(8,10) + '/' + s.slice(5,7) + '/' + s.slice(0,4);
}

function daysLate(iso){
  if (!iso) return null;
  var s = String(iso).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Math.round((new Date(TODAY + 'T00:00:00') - new Date(s + 'T00:00:00')) / 86400000);
}

function addDays(iso, n){
  var d = new Date((iso || TODAY) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

function esc(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function warnDays(){ return num(DB.settings.warn_days) || 7; }
function dueDays(){ var d = num(DB.settings.due_days); return d || 30; }

/* ==================================================== CẦU NỐI SERVER */

/**
 * Gọi 1 chức năng của máy chủ Apps Script. POST dạng text/plain (không phát sinh
 * "preflight" CORS), thân {fn, args, token}; máy chủ trả {ok, data} hoặc {ok:false, error, session}.
 */
function call(fn, args){
  if (!SERVER_ON) return Promise.reject(new Error('Chưa cấu hình máy chủ: dán link /exec vào js/config.js.'));
  document.getElementById('busy').classList.add('on');
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function(){ if (ctl) ctl.abort(); }, 60000);
  var body = JSON.stringify({ fn: fn, args: args || [], token: fn === 'apiLogin' ? '' : TOKEN });
  return fetch(APP_URL, { method: 'POST', body: body, signal: ctl ? ctl.signal : undefined })
    .catch(function(){
      throw new Error(navigator.onLine === false ? 'Đang mất mạng. Thử lại khi có mạng.'
                                                 : 'Không kết nối được máy chủ. Thử lại sau.');
    })
    .then(function(res){
      return res.json().catch(function(){
        throw new Error('Máy chủ trả về dữ liệu lạ. Kiểm tra link Web App và quyền "Bất kỳ ai".');
      });
    })
    .then(function(j){
      if (!j.ok){
        var e = new Error(j.error || 'Lỗi máy chủ.');
        if (j.session && String(e.message).indexOf('AUTH:') < 0) e.message = 'AUTH: ' + e.message;
        throw e;
      }
      return j.data;
    })
    .then(function(r){ done(); return r; }, function(e){
      done();
      if (isAuthErr(e)) showLogin(errText(e));
      throw e;
    });
  function done(){ clearTimeout(timer); document.getElementById('busy').classList.remove('on'); }
}

function errText(e){
  return String(e && e.message ? e.message : e).replace(/^(Error|Exception):\s*/, '')
    .replace(/^AUTH:\s*/, '');
}

function isAuthErr(e){ return String(e && e.message ? e.message : e).indexOf('AUTH:') >= 0; }

function toast(msg, kind){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'on ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ t.className = ''; }, kind === 'err' ? 5200 : 2800);
}

function fail(e){
  if (isAuthErr(e)) return;          // đã chuyển về màn hình đăng nhập
  toast(errText(e), 'err');
}

/* ==================================================== ĐĂNG NHẬP / KHỞI ĐỘNG */

window.addEventListener('DOMContentLoaded', function(){
  document.getElementById('splash').classList.add('off');
  if (!SERVER_ON) {
    showLogin('Chưa cấu hình máy chủ: mở js/config.js, dán link /exec của Apps Script.');
    document.getElementById('lg_btn').disabled = true;
  } else if (TOKEN) { boot(); }
  else { showLogin(''); }
  document.getElementById('verLabel').textContent = 'v' + VERSION;

  document.querySelectorAll('.navbtn[data-page]').forEach(function(b){
    b.addEventListener('click', function(){ go(b.dataset.page); });
  });
  // KHÔNG đóng hộp thoại khi bấm ra nền mờ: bôi đen chữ trong ô rồi thả chuột ra ngoài cũng
  // sinh sự kiện "bấm vào nền" -> trước đây mất sạch dữ liệu đang gõ. Chỉ đóng bằng ✕ / Hủy / Esc.
  ['dlg','dlg2'].forEach(dragDlg);
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    if (document.getElementById('mask').classList.contains('on')
        || document.getElementById('mask2').classList.contains('on')) closeDlg();
  });
  bindSort('tblPartners', renderPartners);
  bindSort('tblProjects', renderProjects);
  bindSort('tblDebt', renderDebt);
});

function doLogin(ev){
  ev.preventDefault();
  var u = document.getElementById('lg_user').value;
  var p = document.getElementById('lg_pass').value;
  var btn = document.getElementById('lg_btn');
  btn.disabled = true; btn.textContent = 'Đang kiểm tra…';
  call('apiLogin', [u, p]).then(function(r){
    btn.disabled = false; btn.textContent = 'Đăng nhập';
    if (!r.ok){
      document.getElementById('lg_err').textContent = r.locked
        ? 'Sai quá nhiều lần. Thử lại sau 10 phút.' : 'Sai tên đăng nhập hoặc mật khẩu.';
      document.getElementById('lg_pass').value = '';
      document.getElementById('lg_pass').focus();
      return;
    }
    TOKEN = r.token;
    lsSet('token', TOKEN);
    document.getElementById('lg_pass').value = '';
    document.getElementById('login').classList.remove('on');
    boot(true);
  }).catch(function(e){
    btn.disabled = false; btn.textContent = 'Đăng nhập';
    document.getElementById('lg_err').textContent = errText(e) || 'Lỗi kết nối.';
  });
  return false;
}

function showLogin(msg){
  TOKEN = ''; ME = null;
  lsSet('token', '');
  document.getElementById('app').classList.remove('ready');
  document.getElementById('splash').classList.add('off');
  ['mask','mask2'].forEach(function(id){ document.getElementById(id).classList.remove('on'); });
  document.getElementById('lg_err').textContent = msg || '';
  document.getElementById('login').classList.add('on');
  setTimeout(function(){ document.getElementById('lg_user').focus(); }, 50);
}

function logout(){
  showLogin('');
}

/** fresh = vừa đăng nhập xong -> đưa về trang mặc định theo quyền. */
function boot(fresh){
  document.getElementById('splash').classList.remove('off');
  reloadAll().then(function(){
    document.getElementById('splash').classList.add('off');
    document.getElementById('app').classList.add('ready');
    if (fresh || !isAdmin()) { if (isAdmin()) go('dashboard'); else openWorkTab(WK_CAT); }
  }).catch(function(e){
    document.getElementById('splash').classList.add('off');
    fail(e);
  });
}

function reloadAll(){
  return call('apiLoad').then(function(d){
    DB = d;
    ME = d.me;
    TODAY = d.today;
    ARISING_OK = {};
    (d.arisings || []).forEach(function(a){
      if (a.status !== 'approved') return;
      var k = String(a.project_id);
      ARISING_OK[k] = (ARISING_OK[k] || 0) + num(a.approved_amount);
    });
    document.getElementById('verLabel').textContent = 'v' + VERSION;
    document.getElementById('sideName').textContent = ME.name || '';
    document.getElementById('sideRole').textContent = ME.title || '';
    document.body.classList.toggle('role-staff', !isAdmin());
    document.body.classList.toggle('not-owner', !ME.owner);
    document.getElementById('navSettingsLb').textContent = isAdmin() ? 'Thiết lập' : 'Tài khoản';
    if (!RANGE) RANGE = defaultRange();
    renderAll();
  });
}

function defaultRange(){
  var y = TODAY.slice(0,4);
  return [y + '-01-01', y + '-12-31'];
}

function renderAll(){
  renderWork();
  renderArea();
  renderSettings();
  if (!isAdmin()) return;
  updateRangeBtn();
  renderDashboard();
  renderPartners();
  renderProjects();
  renderDebtPartnerSelect();
  renderDebt();
  renderArisings();
  renderUsers();
}

function go(page){
  document.querySelectorAll('.navbtn').forEach(function(b){
    b.classList.toggle('active', b.dataset.page === page
      && (page !== 'work' || b.dataset.cat === WK_CAT));
  });
  document.querySelectorAll('.page').forEach(function(s){
    s.classList.toggle('on', s.id === 'page-' + page);
  });
  document.getElementById('main').scrollTop = 0;
}

/* ==================================================== THỐNG KÊ (như bản Python) */

/** Thành tiền = DT × Đơn giá × Hệ số + Xin phép + Phát sinh (QL nhập) + Phát sinh đã duyệt. */
function projectAmount(p){
  return Math.round(num(p.area) * num(p.unit_price) * num(p.factor)
                    + num(p.permit_fee) + num(p.arising_fee) + approvedArising(p.id));
}

function approvedArising(projectId){
  return projectId ? (ARISING_OK[String(projectId)] || 0) : 0;
}

function partnerName(id){
  if (!id) return '';
  for (var i = 0; i < DB.partners.length; i++){
    if (String(DB.partners[i].id) === String(id)) return DB.partners[i].name;
  }
  return '';
}

function advancesOf(projectId){
  return DB.advances.filter(function(a){ return String(a.project_id) === String(projectId); })
    .sort(function(a,b){ return (a.advance_date||'') < (b.advance_date||'') ? -1 : 1; });
}

function floorsOf(projectId){
  return DB.floors.filter(function(f){ return String(f.project_id) === String(projectId); })
    .sort(function(a,b){ return num(a.ord) - num(b.ord); });
}

/** {project_id: {amount, advanced, remain}} — lọc theo Ngày lập nếu truyền khoảng. */
function metricsMap(dfrom, dto){
  var m = {};
  DB.projects.forEach(function(p){
    var c = p.create_date || '';
    if (dfrom && c < dfrom) return;
    if (dto && c > dto) return;
    m[String(p.id)] = { amount: projectAmount(p), advanced: 0, remain: 0 };
  });
  DB.advances.forEach(function(a){
    var k = String(a.project_id);
    if (m[k]) m[k].advanced += num(a.amount);
  });
  Object.keys(m).forEach(function(k){ m[k].remain = m[k].amount - m[k].advanced; });
  return m;
}

/** Công trình còn phải thu (remain>0), kèm số ngày quá hạn. late=null là chưa đặt hạn. */
function debtRows(partnerId){
  var m = metricsMap();
  var rows = [];
  DB.projects.forEach(function(p){
    if (partnerId && String(p.partner_id) !== String(partnerId)) return;
    var met = m[String(p.id)];
    if (!met || met.remain <= 0) return;
    rows.push({ id: p.id, name: p.name, partner: partnerName(p.partner_id),
                due_date: p.due_date, late: daysLate(p.due_date), remain: met.remain });
  });
  rows.sort(function(a,b){
    if ((a.late === null) !== (b.late === null)) return a.late === null ? 1 : -1;
    return (b.late || 0) - (a.late || 0);
  });
  return rows;
}

var AGING_KEYS = ['Chưa có hạn / chưa đến hạn','0-30 ngày','31-60 ngày','61-90 ngày','Trên 90 ngày'];

function aging(partnerId){
  var buckets = {};
  AGING_KEYS.forEach(function(k){ buckets[k] = 0; });
  var rows = debtRows(partnerId);
  rows.forEach(function(r){
    var late = r.late, key;
    if (late === null || late <= 0) key = AGING_KEYS[0];
    else if (late <= 30) key = AGING_KEYS[1];
    else if (late <= 60) key = AGING_KEYS[2];
    else if (late <= 90) key = AGING_KEYS[3];
    else key = AGING_KEYS[4];
    buckets[key] += r.remain;
  });
  return { buckets: buckets, rows: rows };
}

function alerts(){
  var wd = warnDays(), out = [];
  debtRows().forEach(function(r){
    if (r.late === null) return;
    if (r.late > 0){
      out.push({ level: 2, id: r.id, remain: r.remain,
                 text: r.name + ': quá hạn thu tiền ' + r.late + ' ngày' });
    } else if (r.late >= -wd){
      out.push({ level: 1, id: r.id, remain: r.remain,
                 text: r.name + ': sắp đến hạn thu tiền (' + Math.abs(r.late) + ' ngày nữa)' });
    }
  });
  out.sort(function(a,b){ return b.level - a.level; });
  return out;
}

function monthlyAdvances(year){
  var vals = [0,0,0,0,0,0,0,0,0,0,0,0];
  DB.advances.forEach(function(a){
    var d = String(a.advance_date || '');
    if (d.slice(0,4) === String(year)){
      var mth = parseInt(d.slice(5,7), 10);
      if (mth >= 1 && mth <= 12) vals[mth-1] += num(a.amount);
    }
  });
  return vals;
}

function topPartners(dfrom, dto){
  var totals = {};
  DB.projects.forEach(function(p){
    if (!p.partner_id) return;
    var c = p.create_date || '';
    if (dfrom && c < dfrom) return;
    if (dto && c > dto) return;
    var k = String(p.partner_id);
    totals[k] = (totals[k] || 0) + projectAmount(p);
  });
  return Object.keys(totals)
    .map(function(k){ return { id: k, name: partnerName(k) || '?', value: totals[k] }; })
    .sort(function(a,b){ return b.value - a.value; });
}

/** Đối tác chưa thanh toán xong, sắp theo còn phải thu giảm dần. */
function partnerDebts(dfrom, dto){
  var m = metricsMap(dfrom, dto), agg = {};
  DB.projects.forEach(function(p){
    var met = m[String(p.id)];
    if (!met || met.remain <= 0) return;
    var k = String(p.partner_id || '');
    if (!agg[k]) agg[k] = { id: p.partner_id || null, remain: 0, count: 0, late: null, soon: null,
                            name: partnerName(p.partner_id) || '(Chưa có đối tác)' };
    var d = agg[k];
    d.remain += met.remain;
    d.count += 1;
    var late = daysLate(p.due_date);
    if (late === null) return;
    if (late > 0) d.late = d.late === null ? late : Math.max(d.late, late);
    else { var con = -late; d.soon = d.soon === null ? con : Math.min(d.soon, con); }
  });
  return Object.keys(agg).map(function(k){ return agg[k]; })
    .sort(function(a,b){ return b.remain - a.remain; });
}

/* ==================================================== BIỂU ĐỒ SVG */

function barChartSvg(values, w, h){
  var pad = { l: 4, r: 4, t: 14, b: 20 }, n = values.length;
  var maxV = Math.max.apply(null, values.concat([1]));
  var bw = (w - pad.l - pad.r) / n, inner = h - pad.t - pad.b;
  var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" '
        + 'preserveAspectRatio="none" style="display:block">';
  for (var g = 1; g <= 3; g++){
    var gy = pad.t + inner * g / 4;
    s += '<line x1="0" y1="' + gy + '" x2="' + w + '" y2="' + gy
       + '" stroke="#EEF2F7" stroke-width="1"/>';
  }
  values.forEach(function(v, i){
    var bh = maxV > 0 ? Math.max(v > 0 ? 2 : 0, inner * v / maxV) : 0;
    var x = pad.l + i * bw + bw * 0.22, y = pad.t + inner - bh, ww = bw * 0.56;
    s += '<rect x="' + x + '" y="' + y + '" width="' + ww + '" height="' + bh
       + '" rx="2" fill="#1B7CE5"><title>Tháng ' + (i+1) + ': ' + money(v) + '</title></rect>';
    if (v > 0){
      s += '<text x="' + (x + ww/2) + '" y="' + Math.max(10, y - 3)
         + '" font-size="8.5" fill="#6B7A8D" text-anchor="middle">' + shortMoney(v) + '</text>';
    }
    s += '<text x="' + (x + ww/2) + '" y="' + (h - 6)
       + '" font-size="9" fill="#8494A6" text-anchor="middle">' + (i+1) + '</text>';
  });
  return s + '</svg>';
}

function donutSvg(values, size){
  var total = values.reduce(function(a,b){ return a + Math.max(0,b); }, 0);
  var r = size/2, ir = r*0.60, cx = r, cy = r;
  var s = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">';
  if (total <= 0){
    s += ring(cx, cy, r-1, ir, '#E4EAF2');
    return s + '</svg>';
  }
  var ang = -Math.PI/2;
  values.forEach(function(v, i){
    v = Math.max(0, v);
    if (v <= 0) return;
    var sweep = v/total * Math.PI*2;
    var color = DONUT_COLORS[i % DONUT_COLORS.length];
    if (sweep >= Math.PI*2 - 1e-6){ s += ring(cx, cy, r-1, ir, color); ang += sweep; return; }
    var a0 = ang, a1 = ang + sweep, large = sweep > Math.PI ? 1 : 0;
    var x0 = cx + (r-1)*Math.cos(a0), y0 = cy + (r-1)*Math.sin(a0);
    var x1 = cx + (r-1)*Math.cos(a1), y1 = cy + (r-1)*Math.sin(a1);
    var x2 = cx + ir*Math.cos(a1), y2 = cy + ir*Math.sin(a1);
    var x3 = cx + ir*Math.cos(a0), y3 = cy + ir*Math.sin(a0);
    s += '<path d="M' + x0 + ',' + y0 + ' A' + (r-1) + ',' + (r-1) + ' 0 ' + large + ',1 '
       + x1 + ',' + y1 + ' L' + x2 + ',' + y2 + ' A' + ir + ',' + ir + ' 0 ' + large + ',0 '
       + x3 + ',' + y3 + ' Z" fill="' + color + '"/>';
    ang = a1;
  });
  s += '<text x="' + cx + '" y="' + (cy+1) + '" text-anchor="middle" font-size="' + (size*0.13)
     + '" font-weight="700" fill="#1B2430">' + shortMoney(total) + '</text>';
  s += '<text x="' + cx + '" y="' + (cy + size*0.14) + '" text-anchor="middle" font-size="'
     + (size*0.075) + '" fill="#8494A6">tổng</text>';
  return s + '</svg>';

  function ring(cx, cy, ro, ri, fill){
    return '<path fill-rule="evenodd" fill="' + fill + '" d="'
      + 'M' + (cx-ro) + ',' + cy + ' a' + ro + ',' + ro + ' 0 1,0 ' + (ro*2) + ',0 a'
      + ro + ',' + ro + ' 0 1,0 ' + (-ro*2) + ',0 Z '
      + 'M' + (cx-ri) + ',' + cy + ' a' + ri + ',' + ri + ' 0 1,0 ' + (ri*2) + ',0 a'
      + ri + ',' + ri + ' 0 1,0 ' + (-ri*2) + ',0 Z"/>';
  }
}

/* ==================================================== TRANG TỔNG QUAN */

function updateRangeBtn(){
  var b = document.getElementById('rangeBtn');
  b.textContent = RANGE ? '📅 ' + vn(RANGE[0]) + ' → ' + vn(RANGE[1]) : '📅 Toàn bộ thời gian';
}

function renderDashboard(){
  var dfrom = RANGE ? RANGE[0] : null, dto = RANGE ? RANGE[1] : null;
  var year = dfrom ? dfrom.slice(0,4) : TODAY.slice(0,4);
  var m = metricsMap(dfrom, dto), keys = Object.keys(m);

  var amount = 0, adv = 0, remain = 0;
  keys.forEach(function(k){
    amount += m[k].amount; adv += m[k].advanced;
    remain += Math.max(0, m[k].remain);   // không cho công trình ứng dư bù trừ công trình khác
  });
  document.getElementById('c_count').textContent = keys.length;
  document.getElementById('c_amount').textContent = money(amount);
  document.getElementById('c_adv').textContent = money(adv);
  document.getElementById('c_remain').textContent = money(remain);

  // Công trình gần đây
  var recent = DB.projects.filter(function(p){ return m[String(p.id)]; })
    .sort(function(a,b){
      var ca = a.create_date || '', cb = b.create_date || '';
      if (ca !== cb) return ca < cb ? 1 : -1;
      return num(b.id) - num(a.id);
    }).slice(0, 8);
  var tb = document.querySelector('#tblRecent tbody');
  tb.innerHTML = recent.length ? recent.map(function(p){
    var met = m[String(p.id)];
    return '<tr onclick="openProject(' + p.id + ')">'
      + '<td>' + esc(p.name) + '</td>'
      + '<td class="mid">' + esc(partnerName(p.partner_id)) + '</td>'
      + '<td class="num">' + money(met.amount) + '</td>'
      + '<td class="num">' + money(met.remain) + '</td></tr>';
  }).join('') : '<tr><td colspan="4" class="empty">Chưa có công trình nào.</td></tr>';

  // Tạm ứng theo tháng
  document.getElementById('barTitle').textContent = 'Tiền tạm ứng về theo tháng (' + year + ')';
  var box = document.getElementById('barChart');
  box.innerHTML = barChartSvg(monthlyAdvances(year), 380, 200);

  // Đối tác còn nợ
  var debts = partnerDebts(dfrom, dto);
  document.getElementById('debtDonut').innerHTML =
    donutSvg(debts.map(function(d){ return d.remain; }), 150);
  var wd = warnDays();
  document.getElementById('debtLegend').innerHTML = debts.length ? debts.map(function(d, i){
    var phu = '';
    if (d.late) phu = '🔴 quá hạn ' + d.late + ' ngày';
    else if (d.soon !== null && d.soon <= wd) phu = '🟡 còn ' + d.soon + ' ngày tới hạn';
    return '<li class="click" onclick="openDebtFor(' + (d.id || 'null') + ')">'
      + '<span class="dot" style="background:' + DONUT_COLORS[i % DONUT_COLORS.length] + '"></span>'
      + '<span class="nm">' + esc(d.name) + ' — <b>' + money(d.remain) + '</b>'
      + '<span class="sub"><br>' + d.count + ' công trình' + (phu ? ' · ' + phu : '') + '</span></span></li>';
  }).join('') : '<li class="sub">Tất cả đối tác đã thanh toán đủ.</li>';

  // Đối tác theo giá trị
  var top = topPartners(dfrom, dto);
  document.getElementById('topDonut').innerHTML =
    donutSvg(top.map(function(t){ return t.value; }), 150);
  document.getElementById('topLegend').innerHTML = top.length ? top.map(function(t, i){
    return '<li><span class="dot" style="background:' + DONUT_COLORS[i % DONUT_COLORS.length]
      + '"></span><span class="nm">' + esc(t.name) + ' — <b>' + money(t.value) + '</b></span></li>';
  }).join('') : '<li class="sub">Chưa có dữ liệu.</li>';

  // Cảnh báo
  var al = alerts();
  document.getElementById('alertList').innerHTML = al.length ? al.map(function(a){
    return '<li class="lv' + a.level + '" onclick="openProject(' + a.id + ')">'
      + esc(a.text) + ' — <b>' + money(a.remain) + '</b></li>';
  }).join('') : '<li style="color:#6B7A8D;padding:6px">Không có công trình nào quá hạn hay sắp đến hạn.</li>';
}

function openDebtFor(partnerId){
  var sel = document.getElementById('debtPartner');
  sel.value = partnerId === null ? '' : String(partnerId);
  go('debt');
  renderDebt();
}

/* ==================================================== KHOẢNG THỜI GIAN */

function openRange(){
  var y = Number(TODAY.slice(0,4));
  var f = RANGE ? RANGE[0] : y + '-01-01';
  var t = RANGE ? RANGE[1] : y + '-12-31';
  var quick = [
    ['Cả năm ' + y, y + '-01-01', y + '-12-31'],
    ['6 tháng đầu ' + y, y + '-01-01', y + '-06-30'],
    ['6 tháng cuối ' + y, y + '-07-01', y + '-12-31'],
    ['Quý I', y + '-01-01', y + '-03-31'], ['Quý II', y + '-04-01', y + '-06-30'],
    ['Quý III', y + '-07-01', y + '-09-30'], ['Quý IV', y + '-10-01', y + '-12-31'],
    ['Tháng này', TODAY.slice(0,7) + '-01', lastDayOfMonth(TODAY)],
    ['12 tháng gần đây', addDays(TODAY, -365), TODAY],
    ['Năm ngoái', (y-1) + '-01-01', (y-1) + '-12-31'],
  ];
  openDlg({
    title: 'Chọn khoảng thời gian',
    body: '<div class="grid2">'
        + '<label class="fld"><span>Từ ngày</span><input type="date" id="rg_f" value="' + f + '"></label>'
        + '<label class="fld"><span>Đến ngày</span><input type="date" id="rg_t" value="' + t + '"></label>'
        + '</div><div class="sect"><h4>Chọn nhanh</h4>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + quick.map(function(q, i){
            return '<button class="btn sm" onclick="rgSet(' + i + ')">' + q[0] + '</button>';
          }).join('')
        + '</div></div>',
    buttons: [
      { label: 'Toàn bộ thời gian', act: function(){ RANGE = null; closeDlg(); updateRangeBtn(); renderDashboard(); } },
      { label: 'Hủy', act: closeDlg },
      { label: 'Áp dụng', cls: 'primary', act: function(){
          var a = document.getElementById('rg_f').value, b = document.getElementById('rg_t').value;
          if (!a || !b) return toast('Hãy chọn đủ hai ngày.', 'err');
          if (a > b) { var tmp = a; a = b; b = tmp; }
          RANGE = [a, b]; closeDlg(); updateRangeBtn(); renderDashboard();
        } },
    ],
  });
  window.rgSet = function(i){
    document.getElementById('rg_f').value = quick[i][1];
    document.getElementById('rg_t').value = quick[i][2];
  };
}

function lastDayOfMonth(iso){
  var d = new Date(iso.slice(0,4), Number(iso.slice(5,7)), 0);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
}

/* ==================================================== BẢNG: CHỌN & SẮP XẾP */

function bindSort(tableId, rerender){
  var ths = document.querySelectorAll('#' + tableId + ' thead th[data-k]');
  ths.forEach(function(th){
    th.addEventListener('click', function(){
      var k = th.dataset.k, cur = SORT[tableId];
      SORT[tableId] = (cur && cur.k === k) ? { k: k, desc: !cur.desc } : { k: k, desc: false };
      rerender();
    });
  });
}

function applySort(tableId, rows){
  var s = SORT[tableId];
  if (!s) return rows;
  var k = s.k;
  // Kiểu cột lấy theo dữ liệu thật, không đoán từ từng ô — cột ngày để trống lẫn
  // với ngày ISO mà đem so kiểu số thì thứ tự sẽ loạn.
  var numeric = rows.some(function(r){ return typeof r[k] === 'number'; });
  var out = rows.slice();
  out.sort(function(a, b){
    var x = a[k], y = b[k];
    var ex = x === null || x === undefined || x === '';
    var ey = y === null || y === undefined || y === '';
    if (ex && ey) return 0;
    if (ex) return 1;            // ô trống luôn nằm cuối, xuôi hay ngược cũng vậy
    if (ey) return -1;
    var c = numeric ? num(x) - num(y) : String(x).localeCompare(String(y), 'vi');
    return s.desc ? -c : c;
  });
  document.querySelectorAll('#' + tableId + ' thead th').forEach(function(th){
    th.classList.toggle('sorted', th.dataset.k === s.k);
    th.classList.toggle('desc', th.dataset.k === s.k && s.desc);
  });
  return out;
}

function pick(tableId, id, ev){
  if (tableId === 'tblDebt' && ev && (ev.ctrlKey || ev.metaKey)){
    var i = DEBT_SEL.indexOf(String(id));
    if (i >= 0) DEBT_SEL.splice(i, 1); else DEBT_SEL.push(String(id));
    markDebtSel();
    return;
  }
  if (tableId === 'tblDebt'){ DEBT_SEL = [String(id)]; markDebtSel(); return; }
  SEL[tableId] = id;
  document.querySelectorAll('#' + tableId + ' tbody tr').forEach(function(tr){
    tr.classList.toggle('sel', tr.dataset.id === String(id));
  });
}

function markDebtSel(){
  document.querySelectorAll('#tblDebt tbody tr').forEach(function(tr){
    tr.classList.toggle('sel', DEBT_SEL.indexOf(tr.dataset.id) >= 0);
  });
}

function selected(tableId, what){
  var id = SEL[tableId];
  if (!id){ toast('Hãy chọn một dòng trong bảng ' + (what || '') + '.', 'err'); return null; }
  return id;
}

/* ==================================================== TRANG ĐỐI TÁC */

function renderPartners(){
  var kw = (document.getElementById('ptSearch').value || '').trim().toLowerCase();
  var m = metricsMap();
  var rows = DB.partners.map(function(p){
    var count = 0, remain = 0;
    DB.projects.forEach(function(pr){
      if (String(pr.partner_id) !== String(p.id)) return;
      count++;
      var met = m[String(pr.id)];
      if (met && met.remain > 0) remain += met.remain;
    });
    return Object.assign({}, p, { _count: count, _remain: remain });
  });
  if (kw) rows = rows.filter(function(p){
    return [p.name, p.phone, p.address, p.contact, p.note].some(function(v){
      return String(v || '').toLowerCase().indexOf(kw) >= 0;
    });
  });
  rows = applySort('tblPartners', rows);

  var tb = document.querySelector('#tblPartners tbody');
  tb.innerHTML = rows.length ? rows.map(function(p, i){
    return '<tr data-id="' + p.id + '" onclick="pick(\'tblPartners\',' + p.id + ',event)"'
      + ' ondblclick="editPartner(' + p.id + ')">'
      + '<td class="stt">' + (i+1) + '</td>'
      + '<td><b>' + esc(p.name) + '</b></td>'
      + '<td class="mid">' + esc(p.phone) + '</td>'
      + '<td>' + esc(p.address) + '</td>'
      + '<td class="mid">' + esc(p.contact) + '</td>'
      + '<td class="num">' + (num(p.unit_price) ? money(p.unit_price) : '—') + '</td>'
      + '<td class="num">' + p._count + '</td>'
      + '<td class="num">' + (p._remain > 0
          ? '<span class="chip red">' + money(p._remain) + '</span>' : '—') + '</td>'
      + '<td>' + esc(p.note) + '</td></tr>';
  }).join('') : '<tr><td colspan="9" class="empty">Chưa có đối tác nào. Bấm “+ Thêm đối tác”.</td></tr>';
  if (SEL.tblPartners) pick('tblPartners', SEL.tblPartners);
}

function addPartner(){ partnerDlg(null); }

function editPartner(id){
  id = id || selected('tblPartners', 'Đối tác');
  if (!id) return;
  partnerDlg(DB.partners.filter(function(p){ return String(p.id) === String(id); })[0]);
}

function partnerDlg(p){
  p = p || {};
  openDlg({
    title: p.id ? 'Sửa đối tác' : 'Thêm đối tác',
    body: '<label class="fld"><span>Tên đối tác *</span>'
        + '<input type="text" id="pt_name" value="' + esc(p.name) + '"></label>'
        + '<div class="grid2">'
        + '<label class="fld"><span>Điện thoại</span><input type="text" id="pt_phone" value="'
        + esc(p.phone) + '"></label>'
        + '<label class="fld"><span>Người liên hệ</span><input type="text" id="pt_contact" value="'
        + esc(p.contact) + '"></label></div>'
        + '<label class="fld"><span>Địa chỉ</span><input type="text" id="pt_address" value="'
        + esc(p.address) + '"></label>'
        + '<label class="fld"><span>Đơn giá thiết kế (đ/m²) — tự điền khi tạo công trình cho đối tác này</span>'
        + '<input type="text" inputmode="decimal" id="pt_price" value="'
        + (num(p.unit_price) ? moneyPlain(p.unit_price) : '') + '"></label>'
        + '<label class="fld"><span>Tên viết tắt trong tên thư mục Drive (cách nhau dấu phẩy) — '
        + 'VD thư mục “Nhà a Khánh (Cong)” thì ghi: Cong</span>'
        + '<input type="text" id="pt_alias" value="' + esc(p.alias) + '"></label>'
        + '<label class="fld"><span>Ghi chú</span><textarea id="pt_note">' + esc(p.note) + '</textarea></label>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Lưu', cls: 'primary', act: function(){
          var rec = {
            id: p.id || null,
            name: document.getElementById('pt_name').value.trim(),
            phone: document.getElementById('pt_phone').value,
            contact: document.getElementById('pt_contact').value,
            address: document.getElementById('pt_address').value,
            unit_price: docSo(document.getElementById('pt_price').value),
            alias: document.getElementById('pt_alias').value,
            note: document.getElementById('pt_note').value,
          };
          if (!rec.name) return toast('Tên đối tác không được để trống.', 'err');
          call('apiSavePartner', [rec]).then(function(id){
            closeDlg(); SEL.tblPartners = id;
            return reloadAll();
          }).then(function(){ toast('Đã lưu đối tác.', 'ok'); }).catch(fail);
        } },
    ],
  });
  setTimeout(function(){ document.getElementById('pt_name').focus(); }, 60);
}

function delPartner(){
  var id = selected('tblPartners', 'Đối tác');
  if (!id) return;
  var p = DB.partners.filter(function(x){ return String(x.id) === String(id); })[0];
  confirmDlg('Xóa đối tác', 'Xóa đối tác <b>' + esc(p.name) + '</b>?<br>'
    + '<span class="hint">Không xóa được nếu đối tác đang có công trình.</span>', function(){
      call('apiDeletePartner', [id]).then(function(){
        closeDlg(); SEL.tblPartners = null;
        return reloadAll();
      }).then(function(){ toast('Đã xóa đối tác.', 'ok'); }).catch(fail);
    });
}

/* ==================================================== TRANG CÔNG TRÌNH */

function projectRows(){
  var m = metricsMap();
  return DB.projects.map(function(p){
    var met = m[String(p.id)] || { amount: 0, advanced: 0, remain: 0 };
    return Object.assign({}, p, {
      partner_name: partnerName(p.partner_id),
      _arising: num(p.arising_fee) + approvedArising(p.id),
      _amount: met.amount, _advanced: met.advanced, _remain: met.remain,
      _late: daysLate(p.due_date),
    });
  }).sort(function(a,b){
    var ca = a.create_date || '', cb = b.create_date || '';
    if (ca !== cb) return ca < cb ? 1 : -1;
    return num(b.id) - num(a.id);
  });
}

function renderProjects(){
  var kw = (document.getElementById('prSearch').value || '').trim().toLowerCase();
  var rows = projectRows();
  if (kw) rows = rows.filter(function(r){
    return String(r.name || '').toLowerCase().indexOf(kw) >= 0
        || String(r.partner_name || '').toLowerCase().indexOf(kw) >= 0;
  });
  rows = applySort('tblProjects', rows);

  var tb = document.querySelector('#tblProjects tbody');
  tb.innerHTML = rows.length ? rows.map(function(r, i){
    var cls = '';
    if (r._remain > 0 && r._late !== null && r._late > 0) cls = 'bad';
    else if (r._remain > 0) cls = 'warn';
    return '<tr class="' + cls + '" data-id="' + r.id + '"'
      + ' onclick="pick(\'tblProjects\',' + r.id + ',event)"'
      + ' ondblclick="openProject(' + r.id + ')">'
      + '<td class="stt">' + (i+1) + '</td>'
      + '<td><b>' + esc(r.name) + '</b></td>'
      + '<td class="mid">' + esc(r.partner_name) + '</td>'
      + '<td class="mid">' + dienTichVn(r.area) + '</td>'
      + '<td class="mid">' + moneyPlain(r.unit_price) + '</td>'
      + '<td class="mid">' + heSoVn(r.factor) + '</td>'
      + '<td class="num">' + (num(r.permit_fee) ? money(r.permit_fee) : '—') + '</td>'
      + '<td class="num">' + (r._arising ? money(r._arising) : '—') + '</td>'
      + '<td class="num"><b>' + money(r._amount) + '</b></td>'
      + '<td class="num">' + money(r._advanced) + '</td>'
      + '<td class="num">' + (r._remain > 0
          ? '<b style="color:#D64545">' + money(r._remain) + '</b>'
          : '<span class="chip green">Đã thu đủ</span>') + '</td>'
      + '<td class="mid">' + vn(r.due_date) + lateChip(r._late, r._remain) + '</td>'
      + '<td>' + esc(r.note) + '</td></tr>';
  }).join('') : '<tr><td colspan="13" class="empty">Chưa có công trình nào. Bấm “+ Thêm công trình”.</td></tr>';
  if (SEL.tblProjects) pick('tblProjects', SEL.tblProjects);
}

function lateChip(late, remain){
  if (late === null || remain <= 0) return '';
  if (late > 0) return ' <span class="chip red">trễ ' + late + 'n</span>';
  if (-late <= warnDays()) return ' <span class="chip amber">' + (-late) + 'n</span>';
  return '';
}

function addProject(){ projectDlg(null); }

function editProject(){
  var id = selected('tblProjects', 'Công trình');
  if (id) openProject(id);
}

function openProject(id){
  go('projects');
  SEL.tblProjects = id;
  var p = DB.projects.filter(function(x){ return String(x.id) === String(id); })[0];
  if (p) projectDlg(p);
}

function delProject(){
  var id = selected('tblProjects', 'Công trình');
  if (!id) return;
  var p = DB.projects.filter(function(x){ return String(x.id) === String(id); })[0];
  var nAdv = advancesOf(id).length;
  confirmDlg('Xóa công trình', 'Xóa công trình <b>' + esc(p.name) + '</b>?<br>'
    + '<span class="hint">Xóa luôn ' + nAdv + ' lần tạm ứng, các phát sinh và bảng tính diện tích của công trình này. '
    + 'Không hoàn tác được.'
    + (p.drive_id && p.folder_state !== 'missing'
        ? '<br><b>Thư mục Drive của công trình vẫn còn — lần đồng bộ sau sẽ tạo lại công trình (trống). '
          + 'Muốn bỏ hẳn thì xóa thư mục trên Drive.</b>' : '')
    + '</span>', function(){
      call('apiDeleteProject', [id]).then(function(){
        closeDlg(); SEL.tblProjects = null;
        return reloadAll();
      }).then(function(){ toast('Đã xóa công trình.', 'ok'); }).catch(fail);
    });
}

function dupProject(){
  var id = selected('tblProjects', 'Công trình');
  if (!id) return;
  var p = DB.projects.filter(function(x){ return String(x.id) === String(id); })[0];
  openDlg({
    title: 'Nhân bản công trình',
    body: '<p class="hint" style="margin-top:0">Chép mọi thông số của <b>' + esc(p.name)
        + '</b> (đối tác, đơn giá, hệ số, bảng tầng) sang công trình mới. '
        + 'Các lần tạm ứng KHÔNG được chép.</p>'
        + '<label class="fld"><span>Tên công trình mới *</span>'
        + '<input type="text" id="dup_name" value="' + esc(p.name + ' (bản sao)') + '"></label>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Nhân bản', cls: 'primary', act: function(){
          var nm = document.getElementById('dup_name').value.trim();
          if (!nm) return toast('Hãy nhập tên công trình mới.', 'err');
          call('apiDuplicateProject', [id, nm]).then(function(newId){
            closeDlg(); SEL.tblProjects = newId;
            return reloadAll();
          }).then(function(){ toast('Đã nhân bản công trình.', 'ok'); }).catch(fail);
        } },
    ],
  });
  setTimeout(function(){
    var el = document.getElementById('dup_name'); el.focus(); el.select();
  }, 60);
}

/* --------------------------------------------- Hộp thoại công trình */

var PD = null;   // trạng thái công trình đang mở trong hộp thoại

function projectDlg(p){
  var isNew = !p;
  p = p || { create_date: TODAY, due_date: addDays(TODAY, dueDays()), factor: 1 };
  PD = {
    id: p.id || null,
    floors: p.id ? floorsOf(p.id).map(function(f){
              return { name: f.name, length: num(f.length), width: num(f.width), area: num(f.area) };
            }) : [],
    advances: p.id ? advancesOf(p.id).map(function(a){
              return { id: a.id, advance_date: a.advance_date, amount: num(a.amount), note: a.note };
            }) : [],
  };

  var opts = '<option value="">— Chưa có đối tác —</option>' + DB.partners.map(function(x){
    return '<option value="' + x.id + '"' + (String(x.id) === String(p.partner_id) ? ' selected' : '')
      + ' data-price="' + num(x.unit_price) + '">' + esc(x.name) + '</option>';
  }).join('');

  var fromDrive = !!p.drive_id;
  var cats = workCategories();

  openDlg({
    wide: true,
    title: isNew ? 'Thêm công trình' : 'Sửa công trình',
    body:
      '<div class="grid2">'
      + '<label class="fld"><span>Tên công trình *' + (fromDrive ? ' — lấy theo tên thư mục Drive' : '')
      + '</span><input type="text" id="pj_name" value="' + esc(p.name) + '"' + (fromDrive ? ' readonly' : '')
      + '></label>'
      + '<label class="fld"><span>Đối tác' + (p.partner_hint && !p.partner_id
          ? ' — gợi ý từ tên thư mục: <b>' + esc(p.partner_hint) + '</b>' : '') + '</span>'
      + '<select id="pj_partner" onchange="pjPartnerChanged()">' + opts + '</select></label>'
      + '</div>'
      + '<div class="grid2">'
      + '<label class="fld"><span>Loại việc</span><input type="text" id="pj_cat" list="pj_catList" value="'
      + esc(p.category) + '"' + (fromDrive ? ' readonly' : '') + '>'
      + '<datalist id="pj_catList">' + cats.map(function(c){ return '<option value="' + esc(c) + '">'; }).join('')
      + '</datalist></label>'
      + '<label class="fld"><span>Tình trạng</span><input type="text" id="pj_status" list="wk_statusList" value="'
      + esc(p.status) + '">' + statusDatalist() + '</label>'
      + '</div>'
      + '<div class="grid2">'
      + '<label class="fld"><span>Ngày lập</span>'
      + '<input type="date" id="pj_create" value="' + (p.create_date || '') + '" onchange="pjDueFromCreate()"></label>'
      + '<label class="fld"><span>Hạn thu tiền</span>'
      + '<input type="date" id="pj_due" value="' + (p.due_date || '') + '"></label>'
      + '</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 12px">'
      + [15,30,45,60,90].map(function(n){
          return '<button class="btn sm" onclick="pjSetDue(' + n + ')">+' + n + ' ngày</button>';
        }).join('')
      + '</div>'

      + '<div class="sect"><h4>Tính tiền</h4>'
      + '<div class="grid3">'
      + '<label class="fld"><span>Diện tích (m²)</span>'
      + '<input type="text" inputmode="decimal" id="pj_area" oninput="pjRecalc()" value="'
      + (num(p.area) ? dienTichVn(p.area) : '') + '"></label>'
      + '<label class="fld"><span>Đơn giá (đ/m²)</span>'
      + '<input type="text" inputmode="decimal" id="pj_price" oninput="pjRecalc()" value="'
      + (num(p.unit_price) ? moneyPlain(p.unit_price) : '') + '"></label>'
      + '<label class="fld"><span>Hệ số</span>'
      + '<input type="text" inputmode="decimal" id="pj_factor" oninput="pjRecalc()" value="'
      + heSoVn(num(p.factor) || 1) + '"></label>'
      + '</div>'
      + '<div class="grid2">'
      + '<label class="fld"><span>Xin phép xây dựng (đ)</span>'
      + '<input type="text" inputmode="decimal" id="pj_permit" oninput="pjRecalc()" value="'
      + (num(p.permit_fee) ? moneyPlain(p.permit_fee) : '') + '"></label>'
      + '<label class="fld"><span>Phát sinh khác (đ) — ngoài các phát sinh đã duyệt</span>'
      + '<input type="text" inputmode="decimal" id="pj_arising" oninput="pjRecalc()" value="'
      + (num(p.arising_fee) ? moneyPlain(p.arising_fee) : '') + '"></label>'
      + '</div>'
      + (approvedArising(p.id)
          ? '<p class="hint" style="margin:-4px 0 10px">Phát sinh đã duyệt: <b>' + money(approvedArising(p.id))
            + '</b> — xem / sửa ở trang <b>Công việc</b> hoặc <b>Phát sinh</b>.</p>' : '')
      + '<button class="btn sm" onclick="pjOpenFloors()" id="pj_floorBtn">⌗ Tính diện tích theo tầng</button>'
      + '<div class="sumline"><span>Thành tiền:</span> <b id="pj_amount" style="color:#0878E8">0 đ</b>'
      + '<span id="pj_formula" class="hint" style="margin:0"></span></div>'
      + '</div>'

      + '<div class="sect"><h4>Tạm ứng / thu tiền</h4><div id="pj_advBox"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
      + '<button class="btn sm primary" onclick="pjAddAdv()">+ Thêm lần tạm ứng</button>'
      + '<button class="btn sm success" onclick="pjPayFull()">✔ Thu nốt phần còn lại</button></div>'
      + '<div class="sumline"><span>Đã tạm ứng:</span> <b id="pj_adv" style="color:#159957">0 đ</b>'
      + '<span>Còn lại:</span> <b id="pj_remain" style="color:#D64545">0 đ</b></div></div>'

      + '<label class="fld" style="margin-top:14px"><span>Ghi chú</span>'
      + '<textarea id="pj_note">' + esc(p.note) + '</textarea></label>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Lưu công trình', cls: 'primary', act: pjSave },
    ],
  });
  pjRenderAdv();
  pjRecalc();
  setTimeout(function(){ document.getElementById('pj_name').focus(); }, 60);
}

function pjRead(){
  return {
    id: PD.id,
    area: docSo(document.getElementById('pj_area').value),
    unit_price: docSo(document.getElementById('pj_price').value),
    factor: docSo(document.getElementById('pj_factor').value) || 1,
    permit_fee: docSo(document.getElementById('pj_permit').value),
    arising_fee: docSo(document.getElementById('pj_arising').value),
  };
}

/** Dùng chung cho hộp thoại công trình (quản lý) và hộp thoại công việc (nhân viên). */
function pjRecalc(){
  var fb = document.getElementById('pj_floorBtn');
  if (fb) fb.textContent = PD.floors.length
    ? '⌗ Bảng tầng (' + PD.floors.length + ' tầng — ' + dienTichVn(pjFloorTotal()) + ' m²)'
    : '⌗ Tính diện tích theo tầng';
  if (!document.getElementById('pj_amount')) return;   // hộp thoại công việc: không có tiền

  var v = pjRead();
  var amount = projectAmount(v);
  var adv = PD.advances.reduce(function(s, a){ return s + num(a.amount); }, 0);
  document.getElementById('pj_amount').textContent = money(amount);
  document.getElementById('pj_adv').textContent = money(adv);
  document.getElementById('pj_remain').textContent = money(amount - adv);
  var f = dienTichVn(v.area) + ' × ' + moneyPlain(v.unit_price) + ' × ' + heSoVn(v.factor);
  if (v.permit_fee) f += ' + ' + moneyPlain(v.permit_fee);
  if (v.arising_fee) f += ' + ' + moneyPlain(v.arising_fee);
  if (approvedArising(v.id)) f += ' + ' + moneyPlain(approvedArising(v.id)) + ' (PS đã duyệt)';
  document.getElementById('pj_formula').textContent = '( ' + f + ' )';
}

function pjFloorTotal(){
  return PD.floors.reduce(function(s, f){ return s + num(f.area); }, 0);
}

function pjPartnerChanged(){
  var sel = document.getElementById('pj_partner');
  var price = num(sel.options[sel.selectedIndex].dataset.price);
  var cur = docSo(document.getElementById('pj_price').value);
  if (price && !cur){
    document.getElementById('pj_price').value = moneyPlain(price);
    pjRecalc();
  }
}

function pjSetDue(n){
  var c = document.getElementById('pj_create').value || TODAY;
  document.getElementById('pj_due').value = addDays(c, n);
}

function pjDueFromCreate(){
  var due = document.getElementById('pj_due');
  if (!due.value) pjSetDue(dueDays());
}

function pjRenderAdv(){
  var box = document.getElementById('pj_advBox');
  if (!PD.advances.length){
    box.innerHTML = '<p class="hint" style="margin:0">Chưa có lần tạm ứng nào.</p>';
    return;
  }
  box.innerHTML = '<div class="tablewrap" style="box-shadow:none;max-height:200px"><table>'
    + '<thead><tr><th class="stt">#</th><th class="mid">Ngày</th><th class="num">Số tiền</th>'
    + '<th>Ghi chú</th><th style="width:88px"></th></tr></thead><tbody>'
    + PD.advances.map(function(a, i){
        return '<tr><td class="stt">' + (i+1) + '</td>'
          + '<td class="mid">' + vn(a.advance_date) + '</td>'
          + '<td class="num"><b>' + money(a.amount) + '</b></td>'
          + '<td>' + esc(a.note) + '</td>'
          + '<td class="mid"><button class="btn ghost sm" onclick="pjEditAdv(' + i + ')">Sửa</button>'
          + '<button class="btn ghost sm" style="color:#D64545" onclick="pjDelAdv(' + i + ')">✕</button></td></tr>';
      }).join('')
    + '</tbody></table></div>';
}

function pjAddAdv(){ advDlg(null); }
function pjEditAdv(i){ advDlg(i); }

function pjDelAdv(i){
  PD.advances.splice(i, 1);
  pjRenderAdv(); pjRecalc();
}

function pjPayFull(){
  var amount = projectAmount(pjRead());
  var adv = PD.advances.reduce(function(s, a){ return s + num(a.amount); }, 0);
  var remain = amount - adv;
  if (remain <= 0) return toast('Công trình này đã thu đủ.', 'ok');
  PD.advances.push({ advance_date: TODAY, amount: remain, note: 'Thanh toán hết' });
  pjRenderAdv(); pjRecalc();
  toast('Đã thêm khoản thu ' + money(remain) + '. Nhớ bấm “Lưu công trình”.', 'ok');
}

function advDlg(i){
  var a = i === null ? { advance_date: TODAY, amount: '', note: '' } : PD.advances[i];
  openDlg({
    nested: true,
    title: i === null ? 'Thêm lần tạm ứng' : 'Sửa lần tạm ứng',
    body: '<div class="grid2">'
        + '<label class="fld"><span>Ngày tạm ứng</span>'
        + '<input type="date" id="ad_date" value="' + (a.advance_date || TODAY) + '"></label>'
        + '<label class="fld"><span>Số tiền (đ)</span>'
        + '<input type="text" inputmode="decimal" id="ad_amount" value="'
        + (num(a.amount) ? moneyPlain(a.amount) : '') + '"></label></div>'
        + '<label class="fld"><span>Ghi chú</span>'
        + '<input type="text" id="ad_note" value="' + esc(a.note) + '"></label>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Xong', cls: 'primary', act: function(){
          var rec = {
            id: a.id || null,
            advance_date: document.getElementById('ad_date').value || TODAY,
            amount: docSo(document.getElementById('ad_amount').value),
            note: document.getElementById('ad_note').value,
          };
          if (rec.amount <= 0) return toast('Số tiền phải lớn hơn 0.', 'err');
          if (i === null) PD.advances.push(rec); else PD.advances[i] = rec;
          closeDlg(); pjRenderAdv(); pjRecalc();
        } },
    ],
  });
  setTimeout(function(){
    var el = document.getElementById('ad_amount'); el.focus(); el.select();
  }, 60);
}

function pjOpenFloors(){
  var work = PD.floors.map(function(f){ return Object.assign({}, f); });
  if (!work.length) work.push(newFloor(1));
  openDlg({
    nested: true,
    wide: true,
    title: 'Tính diện tích theo tầng',
    body: '<div id="fl_box"></div>'
        + '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm primary" '
        + 'onclick="flAdd()">+ Thêm tầng</button></div>'
        + '<div class="sumline"><span>Tổng diện tích:</span> <b id="fl_total">0</b> <span>m²</span></div>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Dùng tổng diện tích này', cls: 'primary', act: function(){
          PD.floors = work.filter(function(f){ return num(f.area) > 0 || f.name; });
          document.getElementById('pj_area').value = dienTichVn(pjFloorTotal());
          closeDlg(); pjRecalc();
        } },
    ],
  });
  window.flAdd = function(){ work.push(newFloor(work.length + 1)); flRender(); };
  window.flDel = function(i){ work.splice(i, 1); flRender(); };
  window.flEdit = function(i, key, val){
    work[i][key] = key === 'name' ? val : docSo(val);
    if (key === 'length' || key === 'width') work[i].area = work[i].length * work[i].width;
    flRender();
  };
  flRender();

  function flRender(){
    document.getElementById('fl_box').innerHTML =
      '<div class="tablewrap" style="box-shadow:none;max-height:320px"><table>'
      + '<thead><tr><th class="stt">#</th><th>Tên tầng</th><th class="num">Dài (m)</th>'
      + '<th class="num">Rộng (m)</th><th class="num">Diện tích (m²)</th><th style="width:44px"></th></tr></thead><tbody>'
      + work.map(function(f, i){
          return '<tr><td class="stt">' + (i+1) + '</td>'
            + '<td><input type="text" value="' + esc(f.name) + '" onchange="flEdit(' + i + ',\'name\',this.value)"></td>'
            + '<td><input type="text" inputmode="decimal" style="text-align:right" value="'
            + (num(f.length) ? dienTichVn(f.length) : '') + '" onchange="flEdit(' + i + ',\'length\',this.value)"></td>'
            + '<td><input type="text" inputmode="decimal" style="text-align:right" value="'
            + (num(f.width) ? dienTichVn(f.width) : '') + '" onchange="flEdit(' + i + ',\'width\',this.value)"></td>'
            + '<td><input type="text" inputmode="decimal" style="text-align:right" value="'
            + (num(f.area) ? dienTichVn(f.area) : '') + '" onchange="flEdit(' + i + ',\'area\',this.value)"></td>'
            + '<td class="mid"><button class="btn ghost sm" style="color:#D64545" onclick="flDel(' + i + ')">✕</button></td></tr>';
        }).join('')
      + '</tbody></table></div>';
    document.getElementById('fl_total').textContent =
      dienTichVn(work.reduce(function(s, f){ return s + num(f.area); }, 0));
  }
}

function newFloor(n){
  return { name: n === 1 ? 'Tầng trệt' : 'Tầng ' + (n-1), length: 0, width: 0, area: 0 };
}

function pjSave(){
  var v = pjRead();
  var rec = {
    id: PD.id,
    name: document.getElementById('pj_name').value.trim(),
    partner_id: document.getElementById('pj_partner').value || null,
    create_date: document.getElementById('pj_create').value,
    due_date: document.getElementById('pj_due').value,
    area: v.area, unit_price: v.unit_price, factor: v.factor,
    permit_fee: v.permit_fee, arising_fee: v.arising_fee,
    note: document.getElementById('pj_note').value,
    category: document.getElementById('pj_cat').value,
    status: document.getElementById('pj_status').value,
    floors: PD.floors,
    advances: PD.advances,
  };
  if (!rec.name) return toast('Tên công trình không được để trống.', 'err');
  call('apiSaveProject', [rec]).then(function(id){
    closeDlg(); SEL.tblProjects = id;
    return reloadAll();
  }).then(function(){ toast('Đã lưu công trình.', 'ok'); }).catch(fail);
}

/* ==================================================== TRANG CÔNG NỢ */

function renderDebtPartnerSelect(){
  var sel = document.getElementById('debtPartner');
  var cur = sel.value;
  sel.innerHTML = '<option value="">(Tất cả đối tác)</option>' + DB.partners.map(function(p){
    return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
  }).join('');
  sel.value = cur;
}

function renderDebt(){
  var pid = document.getElementById('debtPartner').value || null;
  var res = aging(pid);

  document.getElementById('agingCards').innerHTML = AGING_KEYS.map(function(k){
    return '<div class="card ' + (k === 'Trên 90 ngày' ? 'red' : 'blue') + '">'
      + '<div class="t">' + k + '</div><div class="v">' + money(res.buckets[k]) + '</div></div>';
  }).join('');

  var rows = applySort('tblDebt', res.rows);
  var tb = document.querySelector('#tblDebt tbody');
  tb.innerHTML = rows.length ? rows.map(function(r, i){
    var cls = r.late !== null && r.late > 0 ? 'bad' : (r.late === 0 ? 'warn' : '');
    return '<tr class="' + cls + '" data-id="' + r.id + '"'
      + ' onclick="pick(\'tblDebt\',' + r.id + ',event)" ondblclick="openProject(' + r.id + ')">'
      + '<td class="stt">' + (i+1) + '</td>'
      + '<td><b>' + esc(r.name) + '</b></td>'
      + '<td class="mid">' + esc(r.partner) + '</td>'
      + '<td class="mid">' + (vn(r.due_date) || '—') + '</td>'
      + '<td class="num">' + (r.late === null ? '—'
          : (r.late > 0 ? '<span class="chip red">' + r.late + '</span>' : r.late)) + '</td>'
      + '<td class="num"><b>' + money(r.remain) + '</b></td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty">Không còn công nợ nào. 🎉</td></tr>';
  markDebtSel();
}

function debtSelectAll(){
  DEBT_SEL = [];
  document.querySelectorAll('#tblDebt tbody tr[data-id]').forEach(function(tr){
    DEBT_SEL.push(tr.dataset.id);
  });
  markDebtSel();
  toast('Đã chọn ' + DEBT_SEL.length + ' công trình.');
}

function debtMarkPaid(){
  if (!DEBT_SEL.length){
    return toast('Hãy chọn ít nhất một công trình (giữ Ctrl để chọn nhiều dòng).', 'err');
  }
  var m = metricsMap(), total = 0;
  DEBT_SEL.forEach(function(id){
    var met = m[String(id)];
    if (met && met.remain > 0) total += met.remain;
  });
  confirmDlg('Ghi nhận thu đủ',
    'Ghi nhận thu đủ cho <b>' + DEBT_SEL.length + ' công trình</b>, tổng <b>' + money(total) + '</b>?<br>'
    + '<span class="hint">Mỗi công trình được thêm một lần tạm ứng đúng bằng số còn phải thu, '
    + 'ghi ngày hôm nay.</span>',
    function(){
      call('apiMarkPaidFull', [DEBT_SEL, 'Thanh toán hết']).then(function(n){
        closeDlg(); DEBT_SEL = [];
        return reloadAll().then(function(){ toast('Đã ghi nhận thu đủ ' + n + ' công trình.', 'ok'); });
      }).catch(fail);
    }, 'success');
}

/* ==================================================== TRANG CÔNG VIỆC (mọi tài khoản)

   Giống sheet Excel "Công việc cần làm": nhóm theo loại việc (thư mục cấp 1 trên Drive),
   trong nhóm xếp theo số thứ tự đầu tên thư mục. Không có cột tiền nào ở đây — nhân viên
   cũng không nhận được dữ liệu tiền từ server.                                          */

var STATUS_LIST = ['Mới nhận', 'Đang làm', 'Chờ thông tin', 'Đã gửi bản vẽ', 'Đang chỉnh sửa', 'Hoàn thành'];

function statusDatalist(){
  var seen = {};
  STATUS_LIST.forEach(function(s){ seen[s] = 1; });
  var extra = [];
  DB.projects.forEach(function(p){
    if (p.status && !seen[p.status]){ seen[p.status] = 1; extra.push(p.status); }
  });
  return '<datalist id="wk_statusList">' + STATUS_LIST.concat(extra).map(function(s){
    return '<option value="' + esc(s) + '">';
  }).join('') + '</datalist>';
}

function catCmp(a, b){ return String(a).localeCompare(String(b), 'vi', { numeric: true }); }

/* --------------------------------------------- Loại việc (thư mục cấp 1) — tên hiển thị có dấu
   Thư mục trên máy để không dấu cho dễ đọc ("1. Thiet ke"), giao diện hiện "1. Thiết kế". */

var CAT_VI = {
  'thiet ke': 'Thiết kế', 'tham tra': 'Thẩm tra', 'tham dinh': 'Thẩm định', 'giam sat': 'Giám sát',
  'thi cong': 'Thi công', 'du toan': 'Dự toán', 'khao sat': 'Khảo sát', 'quyet toan': 'Quyết toán',
  'tu van': 'Tư vấn', 'xin phep': 'Xin phép', 'hoan cong': 'Hoàn công', 'cai tao': 'Cải tạo',
  'ket cau': 'Kết cấu', 'kien truc': 'Kiến trúc', 'dien nuoc': 'Điện nước', 'noi that': 'Nội thất',
};
var CAT_ICON = { 'thiet ke': '✎', 'tham tra': '☑', 'giam sat': '◉', 'thi cong': '⚒', 'du toan': '∑' };

function viKey(s){
  // Bỏ dấu: tách chữ và dấu (NFD) rồi xóa khối dấu kết hợp U+0300–U+036F
  return String(s || '').normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'), '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "1. Thiet ke" -> { pre: "1. ", name: "Thiết kế", key: "thiet ke" } */
function catParts(c){
  var m = String(c || '').match(/^(\s*\d+\s*[.\-_)]?\s*)(.*)$/);
  var pre = m && m[2] ? m[1] : '', raw = m && m[2] ? m[2] : String(c || '');
  var key = viKey(raw);
  return { pre: pre, name: CAT_VI[key] || raw, key: key };
}
function catName(c){ return catParts(c).name; }                 // "Thiết kế"
function catLabel(c){ var p = catParts(c); return p.pre + p.name; }  // "1. Thiết kế"

var WK_ALL = '__all', WK_NONE = '__none';
var WK_CAT = '';   // loại việc đang xem (tab bên trái)

/** Tab bên trái: một tab mỗi loại việc + "Khác" (nếu có) + "Tất cả". */
function renderWorkNav(){
  var cats = workCategories();
  var cnt = {}, none = 0;
  DB.projects.forEach(function(p){ if (p.category) cnt[p.category] = (cnt[p.category] || 0) + 1; else none++; });
  var tabs = cats.map(function(c){ return { cat: c, label: catName(c), n: cnt[c], ic: CAT_ICON[catParts(c).key] || '▸' }; });
  if (none) tabs.push({ cat: WK_NONE, label: 'Khác', n: none, ic: '…' });
  tabs.push({ cat: WK_ALL, label: 'Tất cả', n: DB.projects.length, ic: '☰' });
  if (!WK_CAT || !tabs.some(function(t){ return t.cat === WK_CAT; })) WK_CAT = tabs[0].cat;
  var onWork = document.getElementById('page-work').classList.contains('on');
  document.getElementById('navWork').innerHTML = tabs.map(function(t){
    return '<button class="navbtn sub' + (onWork && t.cat === WK_CAT ? ' active' : '') + '" data-page="work"'
      + ' data-cat="' + esc(t.cat) + '" onclick="openWorkTab(this.dataset.cat)">'
      + '<i class="ic">' + t.ic + '</i><span class="lb">' + esc(t.label) + '</span>'
      + '<span class="navcount">' + t.n + '</span></button>';
  }).join('');
}

function openWorkTab(cat){
  WK_CAT = cat;
  SEL.tblWork = null;
  go('work');
  renderWork();
}

function workCategories(){
  var m = {};
  DB.projects.forEach(function(p){ if (p.category) m[p.category] = 1; });
  return Object.keys(m).sort(catCmp);
}

function arisingsOf(projectId){
  return (DB.arisings || []).filter(function(a){ return String(a.project_id) === String(projectId); })
    .sort(function(a, b){ return String(a.created_at).localeCompare(String(b.created_at)); });
}

function fmtStamp(s){
  s = String(s || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? vn(s.slice(0,10)) + s.slice(10) : s;
}

function folderUrl(id){ return 'https://drive.google.com/drive/folders/' + encodeURIComponent(id); }

/* --------------------------------------------- Thư mục đồng bộ trên máy tính này
   Trình duyệt không cho trang web mở thẳng ổ cứng. Hai cách:
   - "copy": chép đường dẫn, người dùng dán vào thanh địa chỉ Explorer.
   - "open": máy đã cài bộ "Mở 1 chạm" (mo-thu-muc/) -> liên kết qlct-open: mở Explorer.
   Đường dẫn gốc mỗi máy một khác nên lưu trong localStorage của máy đó. */

function localRoot(){ return lsGet('local_root'); }
function localMode(){ return lsGet('local_mode') || 'copy'; }

/** <gốc trên máy>\<thư mục loại việc>\<thư mục công trình> — dùng / nếu gốc là đường dẫn kiểu Mac. */
function localPath(p){
  var root = localRoot();
  if (!root || !p.drive_id) return '';
  var sep = root.indexOf('\\') < 0 && root.indexOf('/') >= 0 ? '/' : '\\';
  return [root.replace(/[\\\/]+$/, ''), p.category, p.folder_name || p.name].filter(String).join(sep);
}

function localBtn(p){
  var tip = localRoot() ? (localMode() === 'open' ? 'Mở thư mục trên máy' : 'Chép đường dẫn thư mục trên máy')
                        : 'Chưa khai báo thư mục trên máy này';
  return '<button class="btn ghost sm" title="' + tip + '" onclick="event.stopPropagation();openLocal(' + p.id + ')">💻</button>';
}

function openLocal(id){
  var p = DB.projects.filter(function(x){ return String(x.id) === String(id); })[0];
  if (!p) return;
  if (!localRoot()){
    toast('Khai báo đường dẫn thư mục gốc trên máy này trước.', 'err');
    go('settings');
    setTimeout(function(){ document.getElementById('lc_root').focus(); }, 80);
    return;
  }
  var path = localPath(p);
  if (!p.folder_name) toast('Bấm “Đồng bộ Drive” một lần để lấy đúng tên thư mục.', 'err');
  if (localMode() === 'open'){
    // Máy chưa cài "Mở 1 chạm" thì trình duyệt im lặng không làm gì -> chép sẵn đường dẫn làm dự phòng.
    var a = document.createElement('a');
    a.href = 'qlct-open:' + encodeURIComponent(path);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    copyText(path, 'Đang mở thư mục… Không thấy Explorer mở ra thì máy chưa cài “Mở 1 chạm” — đường dẫn đã chép sẵn, dán vào Explorer (Win+E, Ctrl+L, Ctrl+V).');
    return;
  }
  copyText(path, 'Đã chép đường dẫn. Mở Explorer (Win+E), bấm Ctrl+L, dán Ctrl+V, Enter.');
}

function saveLocal(){
  var root = document.getElementById('lc_root').value.trim().replace(/^"|"$/g, '');
  lsSet('local_root', root);
  lsSet('local_mode', document.getElementById('lc_mode').value);
  renderWork();
  toast(root ? 'Đã lưu thư mục cho máy này.' : 'Đã xóa thư mục của máy này.', 'ok');
}

function localHelp(){
  openDlg({
    title: 'Lấy đường dẫn thư mục gốc trên máy',
    body: '<ol style="margin:0;padding-left:20px;line-height:1.8">'
        + '<li>Mở <b>File Explorer</b> (Win+E) › vào ổ <b>Google Drive</b> (thường là <b>G:</b>).</li>'
        + '<li>Mở tới thư mục gốc chứa <b>1. THIẾT KẾ</b>, <b>2. THẨM TRA</b>.</li>'
        + '<li>Bấm vào <b>thanh địa chỉ</b> phía trên, đường dẫn hiện ra dạng <code>G:\\My Drive\\…</code> › Ctrl+C.</li>'
        + '<li>Quay lại đây dán vào ô <b>Đường dẫn thư mục gốc</b> › <b>Lưu cho máy này</b>.</li></ol>'
        + '<div class="sect"><h4>Mở 1 chạm (Windows)</h4>'
        + '<p style="margin:0">Tải <b>bộ cài “Mở 1 chạm”</b> › chạy file vừa tải (Windows hỏi thì bấm <i>Thêm thông tin › Vẫn chạy</i>) › '
        + 'chọn “Mở thẳng thư mục” › Lưu. Lần đầu bấm 💻 trình duyệt hỏi cho phép mở ứng dụng: tích '
        + '<i>Luôn cho phép</i> › Mở. Bộ cài không cần quyền quản trị, chỉ mở được thư mục có thật, không chạy file nào.</p></div>',
    buttons: [{ label: 'Đóng', cls: 'primary', act: closeDlg }],
  });
}

function workRows(){
  return DB.projects.map(function(p){
    var pend = 0, ok = 0;
    arisingsOf(p.id).forEach(function(a){
      if (a.status === 'pending') pend++;
      else if (a.status === 'approved') ok++;
    });
    return Object.assign({}, p, { partner_name: partnerName(p.partner_id), _pending: pend, _ok: ok });
  }).sort(function(a, b){
    if (!!a.category !== !!b.category) return a.category ? -1 : 1;   // không có loại việc -> cuối
    var c = catCmp(a.category || '', b.category || '');
    if (c) return c;
    var ao = a.ord === null || a.ord === undefined || a.ord === '';
    var bo = b.ord === null || b.ord === undefined || b.ord === '';
    if (ao !== bo) return ao ? 1 : -1;
    if (!ao && num(a.ord) !== num(b.ord)) return num(a.ord) - num(b.ord);
    return catCmp(a.name, b.name);
  });
}

function renderWork(){
  var s = DB.settings || {};
  var fl = document.getElementById('wkFolder');
  fl.classList.toggle('hidden', !s.drive_root_id);
  if (s.drive_root_id) fl.href = folderUrl(s.drive_root_id);
  document.getElementById('wkSync').textContent = s.last_sync
    || (s.drive_root_id ? 'Chưa đồng bộ lần nào.' : 'Chưa liên kết thư mục Google Drive.');

  renderWorkNav();
  var all = WK_CAT === WK_ALL;
  document.getElementById('wkTitle').textContent = all ? 'Công việc · Tất cả'
    : 'Công việc · ' + (WK_CAT === WK_NONE ? 'Khác' : catName(WK_CAT));

  var kw = (document.getElementById('wkSearch').value || '').trim().toLowerCase();
  var flt = document.getElementById('wkFilter').value;
  var rows = workRows().filter(function(r){
    if (!all && (r.category || WK_NONE) !== WK_CAT) return false;
    if (flt === 'noarea' && num(r.area) > 0) return false;
    if (flt === 'pending' && !r._pending) return false;
    if (flt === 'nopartner' && r.partner_id) return false;
    if (flt === 'missing' && r.folder_state !== 'missing') return false;
    if (!kw) return true;
    return [r.name, r.partner_name, r.partner_hint, r.note, r.status].some(function(v){
      return String(v || '').toLowerCase().indexOf(kw) >= 0;
    });
  });

  var counts = {};
  rows.forEach(function(r){ var k = r.category || ''; counts[k] = (counts[k] || 0) + 1; });
  var html = '', last = null;
  rows.forEach(function(r){
    var c = r.category || '';
    if (all && c !== last){   // tab một loại việc thì không cần dòng nhóm
      html += '<tr class="grp"><td colspan="10">' + esc(c ? catLabel(c) : 'Khác — thêm tay, không có thư mục Drive')
        + ' · ' + counts[c] + ' công trình</td></tr>';
      last = c;
    }
    var gone = r.folder_state === 'missing';
    var partner = r.partner_name ? esc(r.partner_name)
      : (r.partner_hint ? '<span class="chip amber" title="Chưa gán đối tác — gợi ý từ tên thư mục">'
                          + esc(r.partner_hint) + '?</span>' : '—');
    var st = r.status ? '<span class="chip ' + (/ho[àa]n th[àa]nh|^ok$/i.test(r.status) ? 'green' : 'blue')
                      + '">' + esc(r.status) + '</span>' : '—';
    var ps = '';
    if (r._pending) ps += '<span class="chip amber">' + r._pending + ' chờ duyệt</span> ';
    if (r._ok) ps += isAdmin() ? '<span class="chip green">+' + moneyPlain(approvedArising(r.id)) + '</span>'
                               : '<span class="chip green">' + r._ok + ' đã duyệt</span>';
    html += '<tr class="' + (gone ? 'gone' : '') + '" data-id="' + r.id + '"'
      + ' onclick="pick(\'tblWork\',' + r.id + ',event)" ondblclick="workDlg(' + r.id + ')">'
      + '<td class="stt">' + (r.ord === null || r.ord === undefined ? '' : r.ord) + '</td>'
      + '<td><b>' + esc(r.name) + '</b>' + (gone ? ' <span class="chip red">thư mục đã xóa</span>' : '') + '</td>'
      + '<td class="mid">' + partner + '</td>'
      + '<td class="num">' + (num(r.area) ? '<b>' + dienTichVn(r.area) + '</b>'
                                          : '<span class="chip amber">chưa nhập</span>') + '</td>'
      + '<td class="mid">' + st + '</td>'
      + '<td class="mid">' + (ps || '—') + '</td>'
      + '<td class="mid" style="font-size:12px">' + esc(r.updated_by || '')
      + (r.updated_at ? '<br><span class="hint">' + fmtStamp(r.updated_at) + '</span>' : '') + '</td>'
      + '<td>' + esc(r.note) + '</td>'
      + '<td class="mid">' + (r.drive_id ? '<a href="' + folderUrl(r.drive_id) + '" target="_blank" rel="noopener"'
          + ' onclick="event.stopPropagation()" title="Mở thư mục trên Drive">📁</a>' : '') + '</td>'
      + '<td class="mid">' + (r.drive_id ? localBtn(r) : '') + '</td></tr>';
  });
  document.querySelector('#tblWork tbody').innerHTML = html
    || '<tr><td colspan="10" class="empty">' + (DB.projects.length ? 'Không có công trình nào khớp bộ lọc.'
       : 'Chưa có công trình. ' + (isAdmin() ? 'Vào Thiết lập → Thư mục Google Drive để liên kết thư mục.'
                                             : 'Bấm “Đồng bộ Drive” để lấy danh sách.')) + '</td></tr>';
  if (SEL.tblWork) pick('tblWork', SEL.tblWork);
}

function editWork(){
  var id = selected('tblWork', 'Công việc');
  if (id) workDlg(id);
}

/* --------------------------------------------- Hộp thoại nhập diện tích / phát sinh */

function workDlg(id){
  var p = DB.projects.filter(function(x){ return String(x.id) === String(id); })[0];
  if (!p) return;
  SEL.tblWork = id;
  PD = {
    id: p.id,
    floors: floorsOf(p.id).map(function(f){
      return { name: f.name, length: num(f.length), width: num(f.width), area: num(f.area) };
    }),
    advances: [],
  };
  var info = [p.category ? catLabel(p.category) : '', partnerName(p.partner_id) || (p.partner_hint ? p.partner_hint + '?' : '')]
    .filter(String).map(esc).join(' · ');
  var buttons = [{ label: 'Hủy', act: closeDlg }];
  if (isAdmin()) buttons.push({ label: '💰 Đơn giá / tạm ứng', act: function(){ closeDlg(); openProject(p.id); } });
  buttons.push({ label: 'Lưu', cls: 'primary', act: wkSave });

  openDlg({
    wide: true,
    title: esc(p.name),
    body:
      '<p class="hint" style="margin-top:0">' + info
      + (p.drive_id ? ' · <a href="' + folderUrl(p.drive_id) + '" target="_blank" rel="noopener">📁 Mở thư mục</a>' : '')
      + (p.updated_by ? ' · Cập nhật: ' + esc(p.updated_by) + ' ' + fmtStamp(p.updated_at) : '') + '</p>'
      + '<div class="sect form-sect"><h4>Thông tin công trình</h4>'
      + '<div class="grid3 wk-row">'
      + '<label class="fld"><span>Đối tác' + (p.partner_hint && !p.partner_id
          ? ' <em class="hint-inline">(thư mục ghi: ' + esc(p.partner_hint) + ')</em>' : '') + '</span>'
      + '<select id="wk_partner">' + partnerOptions(p.partner_id) + '</select></label>'
      + '<div><label class="fld"><span>Tổng diện tích sàn (m²)</span>'
      + '<input type="text" inputmode="decimal" id="pj_area" value="' + (num(p.area) ? dienTichVn(p.area) : '') + '"></label>'
      + '<button class="btn sm" onclick="pjOpenFloors()" id="pj_floorBtn" style="margin:-4px 0 6px"></button></div>'
      + '<label class="fld"><span>Tình trạng</span>'
      + '<input type="text" id="wk_status" list="wk_statusList" value="' + esc(p.status) + '">'
      + statusDatalist() + '</label>'
      + '</div>'
      + '<label class="fld" style="margin:4px 0 0"><span>Ghi chú</span>'
      + '<textarea id="wk_note" placeholder="VD: Cải tạo (tính 40% diện tích), nâng thêm 2 tầng…">'
      + esc(p.note) + '</textarea></label></div>'
      + '<div class="sect"><h4>Phát sinh</h4><div id="wk_arBox"></div>'
      + '<div class="arform">'
      + '<label class="fld"><span>Nội dung phát sinh</span>'
      + '<input type="text" id="wk_arText" placeholder="VD: Mái xiên + hàng rào"></label>'
      + '<label class="fld"><span>Số tiền đề xuất (đ)</span>'
      + '<input type="text" inputmode="decimal" id="wk_arAmt" placeholder="300.000"></label>'
      + '<button class="btn primary" onclick="wkAddArising()">+ Gửi</button></div>'
      + '<p class="hint">' + (isAdmin() ? 'Quản lý thêm phát sinh thì được duyệt luôn.'
                                        : 'Phát sinh gửi lên sẽ chờ quản lý duyệt. Gửi xong là lưu luôn, không cần bấm “Lưu”.')
      + '</p></div>',
    buttons: buttons,
  });
  wkRenderArisings();
  pjRecalc();
  setTimeout(function(){ var el = document.getElementById('pj_area'); el.focus(); el.select(); }, 60);
}

/** Danh sách đối tác xếp theo tên (tiếng Việt) cho ô chọn. */
function partnerOptions(selectedId){
  var list = DB.partners.slice().sort(function(a, b){ return catCmp(a.name, b.name); });
  return '<option value="">— Chọn đối tác —</option>' + list.map(function(x){
    return '<option value="' + x.id + '"' + (String(x.id) === String(selectedId) ? ' selected' : '') + '>'
      + esc(x.name) + '</option>';
  }).join('');
}

function wkRenderArisings(){
  var box = document.getElementById('wk_arBox');
  if (!box || !PD) return;
  var list = arisingsOf(PD.id);
  box.innerHTML = list.length ? list.map(function(a){
    var st = a.status === 'approved'
      ? '<span class="chip green">Đã duyệt' + (isAdmin() ? ' ' + moneyPlain(a.approved_amount) : '') + '</span>'
      : (a.status === 'rejected' ? '<span class="chip red">Từ chối</span>' : '<span class="chip amber">Chờ duyệt</span>');
    var acts = '';
    if (isAdmin()) acts += '<button class="btn ghost sm" onclick="reviewDlg(' + a.id + ',true)">Duyệt…</button>';
    if (isAdmin() || (a.created_uid === ME.username && a.status === 'pending')){
      acts += '<button class="btn ghost sm" style="color:#D64545" onclick="wkDelArising(' + a.id + ')">✕</button>';
    }
    return '<div class="ar-item"><div class="tx"><b>' + esc(a.content) + '</b><small>'
      + esc(a.created_by) + ' · ' + fmtStamp(a.created_at)
      + (a.review_note ? ' · QL ghi: ' + esc(a.review_note) : '') + '</small></div>'
      + '<div class="amt">' + (num(a.amount) ? money(a.amount) : '—') + '</div>'
      + '<div>' + st + '</div><div style="white-space:nowrap">' + acts + '</div></div>';
  }).join('') : '<p class="hint" style="margin:0">Chưa có phát sinh nào.</p>';
}

function wkAddArising(){
  var content = document.getElementById('wk_arText').value.trim();
  var amount = docSo(document.getElementById('wk_arAmt').value);
  if (!content) return toast('Hãy ghi nội dung phát sinh.', 'err');
  call('apiAddArising', [{ project_id: PD.id, content: content, amount: amount }]).then(function(){
    document.getElementById('wk_arText').value = '';
    document.getElementById('wk_arAmt').value = '';
    return reloadAll();
  }).then(function(){
    wkRenderArisings();
    toast(isAdmin() ? 'Đã thêm phát sinh (đã duyệt).' : 'Đã gửi phát sinh, chờ quản lý duyệt.', 'ok');
  }).catch(fail);
}

function wkDelArising(aid){
  confirmDlg('Xóa phát sinh', 'Xóa phát sinh này?', function(){
    call('apiDeleteArising', [aid]).then(function(){
      closeDlg();
      return reloadAll();
    }).then(function(){ wkRenderArisings(); toast('Đã xóa phát sinh.', 'ok'); }).catch(fail);
  }, 'danger', true);
}

function wkSave(){
  var rec = {
    id: PD.id,
    partner_id: document.getElementById('wk_partner').value || '',
    area: docSo(document.getElementById('pj_area').value),
    status: document.getElementById('wk_status').value,
    note: document.getElementById('wk_note').value,
    floors: PD.floors,
  };
  call('apiSaveWork', [rec]).then(function(){
    closeDlg();
    return reloadAll();
  }).then(function(){ toast('Đã lưu.', 'ok'); }).catch(fail);
}

/* ==================================================== TRANG PHÁT SINH (quản lý) */

function projectNameOf(id){
  var p = DB.projects.filter(function(x){ return String(x.id) === String(id); })[0];
  return p ? p.name : '(công trình đã xóa)';
}

var AR_STATUS = {
  pending: '<span class="chip amber">Chờ duyệt</span>',
  approved: '<span class="chip green">Đã duyệt</span>',
  rejected: '<span class="chip red">Từ chối</span>',
};

function renderArisings(){
  var all = DB.arisings || [];
  var nPend = all.filter(function(a){ return a.status === 'pending'; }).length;
  document.getElementById('arBadge').textContent = nPend ? String(nPend) : '';

  var f = document.getElementById('arFilter').value;
  var rows = all.filter(function(a){ return !f || a.status === f; })
    .sort(function(a, b){ return String(b.created_at).localeCompare(String(a.created_at)); });
  document.querySelector('#tblArisings tbody').innerHTML = rows.length ? rows.map(function(a, i){
    return '<tr data-id="' + a.id + '" onclick="pick(\'tblArisings\',' + a.id + ',event)"'
      + ' ondblclick="reviewDlg(' + a.id + ',false)">'
      + '<td class="stt">' + (i+1) + '</td>'
      + '<td class="mid" style="font-size:12px">' + fmtStamp(a.created_at) + '</td>'
      + '<td><b>' + esc(projectNameOf(a.project_id)) + '</b></td>'
      + '<td>' + esc(a.content) + (a.review_note ? '<br><span class="hint">QL ghi: ' + esc(a.review_note) + '</span>' : '') + '</td>'
      + '<td class="num">' + (num(a.amount) ? money(a.amount) : '—') + '</td>'
      + '<td class="num">' + (a.status === 'approved' ? '<b>' + money(a.approved_amount) + '</b>' : '—') + '</td>'
      + '<td class="mid">' + (AR_STATUS[a.status] || esc(a.status)) + '</td>'
      + '<td class="mid">' + esc(a.created_by) + '</td>'
      + '<td class="mid">' + esc(a.reviewed_by) + '</td></tr>';
  }).join('') : '<tr><td colspan="9" class="empty">' + (f === 'pending' ? 'Không có phát sinh nào chờ duyệt.'
                                                                         : 'Không có phát sinh nào.') + '</td></tr>';
  if (SEL.tblArisings) pick('tblArisings', SEL.tblArisings);
}

function arReview(){
  var id = selected('tblArisings', 'Phát sinh');
  if (id) reviewDlg(id, false);
}

function arDelete(){
  var id = selected('tblArisings', 'Phát sinh');
  if (!id) return;
  confirmDlg('Xóa phát sinh', 'Xóa hẳn phát sinh này? Nếu chỉ không đồng ý thì nên bấm “Từ chối”.', function(){
    call('apiDeleteArising', [id]).then(function(){
      closeDlg(); SEL.tblArisings = null;
      return reloadAll();
    }).then(function(){ toast('Đã xóa phát sinh.', 'ok'); }).catch(fail);
  });
}

/** nested = true khi mở từ trong hộp thoại công việc. */
function reviewDlg(aid, nested){
  var a = (DB.arisings || []).filter(function(x){ return String(x.id) === String(aid); })[0];
  if (!a) return;
  var buttons = [{ label: 'Hủy', act: closeDlg }];
  if (a.status !== 'pending') buttons.push({ label: 'Đưa về chờ duyệt', act: function(){ go2('pending'); } });
  buttons.push({ label: '✕ Từ chối', cls: 'danger', act: function(){ go2('rejected'); } });
  buttons.push({ label: '✔ Duyệt', cls: 'success', act: function(){ go2('approved'); } });
  openDlg({
    nested: !!nested,
    title: 'Duyệt phát sinh',
    body: '<p style="margin-top:0"><b>' + esc(projectNameOf(a.project_id)) + '</b><br>' + esc(a.content) + '</p>'
        + '<p class="hint">Gửi bởi ' + esc(a.created_by) + ' lúc ' + fmtStamp(a.created_at)
        + ' — đề xuất <b>' + money(a.amount) + '</b>. Hiện tại: ' + (AR_STATUS[a.status] || '') + '</p>'
        + '<label class="fld"><span>Số tiền được duyệt (đ)</span>'
        + '<input type="text" inputmode="decimal" id="rv_amt" value="'
        + moneyPlain(a.status === 'approved' ? a.approved_amount : a.amount) + '"></label>'
        + '<label class="fld"><span>Ghi chú gửi nhân viên (tùy chọn)</span>'
        + '<input type="text" id="rv_note" value="' + esc(a.review_note) + '"></label>',
    buttons: buttons,
  });
  setTimeout(function(){ var el = document.getElementById('rv_amt'); el.focus(); el.select(); }, 60);

  function go2(decision){
    var amt = docSo(document.getElementById('rv_amt').value);
    var note = document.getElementById('rv_note').value;
    call('apiReviewArising', [aid, decision, amt, note]).then(function(){
      closeDlg();
      return reloadAll();
    }).then(function(){
      if (nested) wkRenderArisings();
      toast({ approved: 'Đã duyệt ' + money(amt) + '.', rejected: 'Đã từ chối phát sinh.',
              pending: 'Đã đưa về chờ duyệt.' }[decision], 'ok');
    }).catch(fail);
  }
}

/* ==================================================== XUẤT EXCEL */

function exportSheet(kind){
  var opts = {};
  if (kind === 'debt') opts.partnerId = document.getElementById('debtPartner').value || null;
  else opts.keyword = (document.getElementById('prSearch').value || '').trim();

  toast('Đang tạo file…');
  call('apiExport', [kind, opts]).then(function(r){
    openDlg({
      title: 'Đã xuất xong',
      body: '<p style="margin-top:0">Đã tạo file <b>' + esc(r.name) + '</b> gồm <b>' + r.count
          + '</b> công trình, lưu trên Google Drive của bạn.</p>'
          + '<p class="hint">Cột <b>Thành tiền</b> và <b>Còn lại</b> là công thức trỏ vào các cột '
          + 'diện tích – đơn giá – hệ số, đối tác mở ra tự kiểm tra được.</p>',
      buttons: [
        { label: 'Đóng', act: closeDlg },
        { label: '⬇ Tải bản .xlsx', act: function(){ window.open(r.xlsxUrl, '_blank'); } },
        { label: 'Mở trên Google Sheets', cls: 'primary',
          act: function(){ window.open(r.url, '_blank'); } },
      ],
    });
  }).catch(fail);
}

/* ==================================================== TRANG TÍNH DIỆN TÍCH */

function renderArea(){
  if (!AREA_ROWS.length) AREA_ROWS = [newFloor(1)];
  document.querySelector('#tblArea tbody').innerHTML = AREA_ROWS.map(function(f, i){
    return '<tr><td class="stt">' + (i+1) + '</td>'
      + '<td><input type="text" value="' + esc(f.name) + '" onchange="areaEdit(' + i + ',\'name\',this.value)"></td>'
      + '<td><input type="text" inputmode="decimal" style="text-align:right" value="'
      + (num(f.length) ? dienTichVn(f.length) : '') + '" onchange="areaEdit(' + i + ',\'length\',this.value)"></td>'
      + '<td><input type="text" inputmode="decimal" style="text-align:right" value="'
      + (num(f.width) ? dienTichVn(f.width) : '') + '" onchange="areaEdit(' + i + ',\'width\',this.value)"></td>'
      + '<td><input type="text" inputmode="decimal" style="text-align:right" value="'
      + (num(f.area) ? dienTichVn(f.area) : '') + '" onchange="areaEdit(' + i + ',\'area\',this.value)"></td>'
      + '<td class="mid"><button class="btn ghost sm" style="color:#D64545" onclick="areaDel(' + i + ')">✕</button></td></tr>';
  }).join('');
  document.getElementById('areaTotal').textContent =
    dienTichVn(AREA_ROWS.reduce(function(s, f){ return s + num(f.area); }, 0));
}

function areaAdd(){ AREA_ROWS.push(newFloor(AREA_ROWS.length + 1)); renderArea(); }
function areaDel(i){ AREA_ROWS.splice(i, 1); renderArea(); }
function areaReset(){ AREA_ROWS = [newFloor(1)]; renderArea(); }

function areaEdit(i, key, val){
  AREA_ROWS[i][key] = key === 'name' ? val : docSo(val);
  if (key === 'length' || key === 'width'){
    AREA_ROWS[i].area = AREA_ROWS[i].length * AREA_ROWS[i].width;
  }
  renderArea();
}

/* ==================================================== TRANG THIẾT LẬP */

function renderSettings(){
  var s = DB.settings;
  document.getElementById('stTitle').textContent = isAdmin() ? 'Thiết lập' : 'Tài khoản';
  document.getElementById('stSub').textContent = isAdmin()
    ? 'Tài khoản, nhân viên, thư mục Drive, sao lưu và dữ liệu' : 'Đổi mật khẩu đăng nhập';
  document.getElementById('lc_root').value = localRoot();
  document.getElementById('lc_mode').value = localMode();
  document.getElementById('st_me').innerHTML ='Đang đăng nhập: <b>' + esc(ME.name) + '</b> ('
    + esc(ME.username) + ') — ' + esc(ME.title);
  document.getElementById('st_drive').value = s.drive_root_id
    ? 'https://drive.google.com/drive/folders/' + s.drive_root_id : '';
  document.getElementById('st_driveName').innerHTML = s.drive_root_name
    ? '📁 Đang dùng thư mục: <b>' + esc(s.drive_root_name) + '</b>' : 'Chưa chọn thư mục.';
  document.getElementById('st_lastSync').textContent = s.last_sync || '';
  document.getElementById('st_autosync').textContent = s.auto_sync === '1'
    ? '⏸ Tắt tự đồng bộ' : '⏰ Bật tự đồng bộ 15 phút';
  document.getElementById('st_name').value = s.user_display_name || '';
  document.getElementById('st_role').value = s.user_role || '';
  document.getElementById('st_user').value = s.auth_username || '';
  document.getElementById('st_warn').value = warnDays();
  document.getElementById('st_due').value = dueDays();
  document.getElementById('st_org').value = s.export_org || '';
  document.getElementById('st_dataLink').href = DB.dataUrl || '#';
  document.getElementById('st_daily').textContent =
    s.daily_backup === '1' ? '⏸ Tắt sao lưu hằng ngày' : '⏰ Bật sao lưu hằng ngày';
}

function saveAccount(){
  call('apiSaveSettings', [{
    user_display_name: document.getElementById('st_name').value,
    user_role: document.getElementById('st_role').value,
    auth_username: document.getElementById('st_user').value.trim(),
  }]).then(function(){ return reloadAll(); })
    .then(function(){ toast('Đã lưu thông tin tài khoản.', 'ok'); }).catch(fail);
}

function saveOptions(){
  call('apiSaveSettings', [{
    warn_days: document.getElementById('st_warn').value,
    due_days: document.getElementById('st_due').value,
    export_org: document.getElementById('st_org').value,
  }]).then(function(){ return reloadAll(); })
    .then(function(){ toast('Đã lưu tùy chọn.', 'ok'); }).catch(fail);
}

function savePassword(){
  var p0 = document.getElementById('st_p0').value;
  var p1 = document.getElementById('st_p1').value;
  var p2 = document.getElementById('st_p2').value;
  if (p1 !== p2) return toast('Hai ô mật khẩu mới không giống nhau.', 'err');
  call('apiChangePassword', [p0, p1]).then(function(r){
    if (r && r.token){ TOKEN = r.token; lsSet('token', TOKEN); }
    ['st_p0','st_p1','st_p2'].forEach(function(id){ document.getElementById(id).value = ''; });
    toast('Đã đổi mật khẩu.', 'ok');
  }).catch(fail);
}

function doBackup(){
  toast('Đang sao lưu…');
  call('apiBackup').then(function(r){
    toast('Đã sao lưu: ' + r.name, 'ok');
  }).catch(fail);
}

function toggleDailyBackup(){
  var on = DB.settings.daily_backup !== '1';
  call('apiEnableDailyBackup', [on]).then(function(){
    return reloadAll();
  }).then(function(){
    toast(on ? 'Đã bật sao lưu tự động mỗi ngày lúc 1 giờ sáng.' : 'Đã tắt sao lưu tự động.', 'ok');
  }).catch(fail);
}

/* --------------------------------------------- Thư mục Drive */

function saveDriveRoot(){
  var v = document.getElementById('st_drive').value.trim();
  if (!v) return toast('Hãy dán link thư mục Google Drive.', 'err');
  toast('Đang kiểm tra thư mục và đồng bộ…');
  call('apiSaveDriveRoot', [v]).then(function(r){
    return reloadAll().then(function(){ toast(r.summary, 'ok'); });
  }).catch(fail);
}

function syncDrive(){
  if (!DB.settings.drive_root_id){
    return toast(isAdmin() ? 'Chưa chọn thư mục Drive — vào Thiết lập → Thư mục Google Drive.'
                           : 'Quản lý chưa chọn thư mục Drive.', 'err');
  }
  toast('Đang đồng bộ thư mục Drive…');
  call('apiSyncDrive').then(function(r){
    return reloadAll().then(function(){ toast(r.summary, 'ok'); });
  }).catch(fail);
}

function toggleAutoSync(){
  var on = DB.settings.auto_sync !== '1';
  call('apiEnableAutoSync', [on]).then(function(){ return reloadAll(); }).then(function(){
    toast(on ? 'Đã bật tự đồng bộ mỗi 15 phút.' : 'Đã tắt tự đồng bộ.', 'ok');
  }).catch(fail);
}

/* --------------------------------------------- Tài khoản nhân viên */

/** Chuẩn hóa tên đăng nhập giống máy chủ (normLogin_ trong CongViec.gs):
 *  "0969.776.655" / "+84969776655" / "969776655" -> "0969776655". */
function normLogin(v){
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!/^\+?\d[\d\s.\-()]*$/.test(s)) return s.replace(/\s+/g, '');
  var d = s.replace(/\D/g, '');
  if (/^84\d{9}$/.test(d)) d = '0' + d.slice(2);
  else if (/^[1-9]\d{8}$/.test(d)) d = '0' + d;
  return d;
}

function appLink(){ return location.href.split('#')[0].split('?')[0]; }

/** Chép chữ vào bộ nhớ tạm; máy không cho chép tự động thì hiện hộp để chép tay. */
function copyText(text, okMsg){
  function manual(){
    openDlg({ nested: document.getElementById('mask').classList.contains('on'),
      title: 'Sao chép nội dung này',
      body: '<textarea id="cp_txt" rows="6" readonly style="width:100%">' + esc(text) + '</textarea>'
          + '<p class="hint">Bấm giữ (điện thoại) hoặc Ctrl+C (máy tính) để chép.</p>',
      buttons: [{ label: 'Đóng', cls: 'primary', act: closeDlg }] });
    setTimeout(function(){ var t = document.getElementById('cp_txt'); t.focus(); t.select(); }, 60);
  }
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){ toast(okMsg || 'Đã sao chép.', 'ok'); }, manual);
  } else {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    if (ok) toast(okMsg || 'Đã sao chép.', 'ok'); else manual();
  }
}

/** Tin nhắn gửi nhân viên qua Zalo (giống Luyện Toán THCS). */
function loginMessage(u){
  return 'Quản lý công trình\n'
    + 'Link: ' + appLink() + '\n'
    + 'Tên đăng nhập: ' + u.username + '\n'
    + 'Mật khẩu: ' + u.username + ' (nếu chưa đổi)';
}

function copyUser(id){
  var u = (DB.users || []).filter(function(x){ return String(x.id) === String(id); })[0];
  if (u) copyText(loginMessage(u), 'Đã sao chép, dán vào Zalo để gửi.');
}

function renderUsers(){
  var tb = document.querySelector('#tblUsers tbody');
  var rows = DB.users || [];
  tb.innerHTML = rows.length ? rows.map(function(u){
    return '<tr data-id="' + u.id + '" onclick="pick(\'tblUsers\',' + u.id + ',event)"'
      + ' ondblclick="editUser(' + u.id + ')">'
      + '<td><b>' + esc(u.username) + '</b></td><td>' + esc(u.display_name) + '</td>'
      + '<td class="mid">' + (u.role === 'admin' ? '<span class="chip blue">Quản lý</span>'
                                                 : '<span class="chip gray">Nhân viên</span>') + '</td>'
      + '<td class="mid">' + (u.active === '0' ? '<span class="chip red">Đã khóa</span>'
                                               : '<span class="chip green">Hoạt động</span>') + '</td>'
      + '<td class="mid" style="white-space:nowrap" onclick="event.stopPropagation()">'
      + '<button class="btn sm" onclick="copyUser(' + u.id + ')">📋 Sao chép</button> '
      + '<button class="btn sm" onclick="resetUser(' + u.id + ')">Đặt lại MK</button></td></tr>';
  }).join('') : '<tr><td colspan="5" class="empty">Chưa có tài khoản nhân viên nào.</td></tr>';
  if (SEL.tblUsers) pick('tblUsers', SEL.tblUsers);
}

function editUser(id){
  id = id || selected('tblUsers', 'Tài khoản nhân viên');
  if (!id) return;
  userDlg((DB.users || []).filter(function(u){ return String(u.id) === String(id); })[0]);
}

function userDlg(u){
  var isNew = !u;
  u = u || { role: 'staff', active: '1' };
  openDlg({
    title: isNew ? 'Thêm tài khoản nhân viên' : 'Sửa tài khoản',
    body: '<div class="grid2">'
        + '<label class="fld"><span>Tên đăng nhập * (không dấu, dùng số điện thoại được)</span>'
        + '<input type="text" id="us_user" autocomplete="off" autocapitalize="none" spellcheck="false"'
        + ' placeholder="vd: 0969776655" value="' + esc(u.username) + '"></label>'
        + '<label class="fld"><span>Họ tên</span>'
        + '<input type="text" id="us_name" placeholder="vd: Nguyễn Văn A" value="' + esc(u.display_name) + '"></label></div>'
        + '<div class="grid2">'
        + '<label class="fld"><span>Quyền</span><select id="us_role">'
        + '<option value="staff"' + (u.role !== 'admin' ? ' selected' : '') + '>Nhân viên — nhập diện tích, phát sinh</option>'
        + '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Quản lý — thấy đơn giá, công nợ</option>'
        + '</select></label>'
        + '<label class="fld"><span>' + (isNew ? 'Mật khẩu (để trống = trùng tên đăng nhập)'
                                                : 'Mật khẩu mới (để trống = giữ nguyên)') + '</span>'
        + '<input type="text" id="us_pass" autocomplete="new-password" autocapitalize="none"></label></div>'
        + '<p class="hint" id="us_hint" style="margin-top:-4px"></p>'
        + '<label style="display:flex;gap:7px;align-items:center;font-size:13px;margin:4px 0 10px">'
        + '<input type="checkbox" id="us_active" style="width:auto"' + (u.active !== '0' ? ' checked' : '') + '>'
        + ' Cho phép đăng nhập</label>'
        + '<label class="fld"><span>Ghi chú</span><input type="text" id="us_note" value="' + esc(u.note) + '"></label>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Lưu', cls: 'primary', act: function(){
          var rec = {
            id: u.id || null,
            username: normLogin(document.getElementById('us_user').value),
            display_name: document.getElementById('us_name').value.trim(),
            role: document.getElementById('us_role').value,
            password: document.getElementById('us_pass').value.trim(),
            active: document.getElementById('us_active').checked,
            note: document.getElementById('us_note').value,
          };
          if (!rec.username) return toast('Hãy nhập tên đăng nhập.', 'err');
          var defPw = isNew && !rec.password;
          call('apiSaveUser', [rec]).then(function(id){
            closeDlg(); SEL.tblUsers = id;
            return reloadAll().then(function(){
              if (isNew) showCreated(id, defPw);
              else toast('Đã lưu tài khoản.', 'ok');
            });
          }).catch(fail);
        } },
    ],
  });
  // Cho thấy ngay số điện thoại sẽ được lưu thế nào (giữ số 0 đầu).
  var inp = document.getElementById('us_user'), hint = document.getElementById('us_hint');
  inp.oninput = function(){
    var n = normLogin(inp.value);
    hint.innerHTML = n && n !== inp.value.trim().toLowerCase()
      ? 'Sẽ lưu tên đăng nhập là: <b>' + esc(n) + '</b>' : '';
  };
  setTimeout(function(){ inp.focus(); }, 60);
}

/** Vừa tạo tài khoản: hiện tin nhắn đăng nhập kèm nút Sao chép để gửi Zalo. */
function showCreated(id, defPw){
  var u = (DB.users || []).filter(function(x){ return String(x.id) === String(id); })[0];
  if (!u) return toast('Đã thêm tài khoản.', 'ok');
  var msg = defPw ? loginMessage(u)
    : 'Quản lý công trình\nLink: ' + appLink() + '\nTên đăng nhập: ' + u.username + '\nMật khẩu: (mật khẩu bạn vừa đặt)';
  openDlg({
    title: 'Đã thêm tài khoản ' + esc(u.username),
    body: '<p style="margin-top:0">Gửi tin nhắn này cho <b>' + esc(u.display_name) + '</b> qua Zalo:</p>'
        + '<textarea rows="5" readonly style="width:100%">' + esc(msg) + '</textarea>',
    buttons: [
      { label: 'Đóng', act: closeDlg },
      { label: '📋 Sao chép', cls: 'primary', act: function(){
          closeDlg(); copyText(msg, 'Đã sao chép, dán vào Zalo để gửi.'); } },
    ],
  });
}

function resetUser(id){
  var u = (DB.users || []).filter(function(x){ return String(x.id) === String(id); })[0];
  if (!u) return;
  confirmDlg('Đặt lại mật khẩu', 'Đặt lại mật khẩu của <b>' + esc(u.username) + '</b> thành <b>'
    + esc(u.username) + '</b>?<br><span class="hint">Người này sẽ bị đăng xuất khỏi mọi máy.</span>', function(){
      call('apiResetUserPassword', [id]).then(function(){
        closeDlg();
        openDlg({
          title: 'Đã đặt lại mật khẩu',
          body: '<p style="margin-top:0">Mật khẩu của <b>' + esc(u.username) + '</b> giờ là <b>' + esc(u.username) + '</b>.</p>',
          buttons: [
            { label: 'Đóng', act: closeDlg },
            { label: '📋 Sao chép tin nhắn', cls: 'primary', act: function(){
                closeDlg(); copyText(loginMessage(u), 'Đã sao chép, dán vào Zalo để gửi.'); } },
          ],
        });
      }).catch(fail);
    }, 'primary');
}

function delUser(){
  var id = selected('tblUsers', 'Tài khoản nhân viên');
  if (!id) return;
  var u = DB.users.filter(function(x){ return String(x.id) === String(id); })[0];
  confirmDlg('Xóa tài khoản', 'Xóa tài khoản <b>' + esc(u.username) + '</b>?<br>'
    + '<span class="hint">Dữ liệu người này đã nhập vẫn giữ nguyên. Muốn tạm chặn thì bỏ tích '
    + '“Cho phép đăng nhập” thay vì xóa.</span>', function(){
      call('apiDeleteUser', [id]).then(function(){
        closeDlg(); SEL.tblUsers = null;
        return reloadAll();
      }).then(function(){ toast('Đã xóa tài khoản.', 'ok'); }).catch(fail);
    });
}

function doImport(){
  var f = document.getElementById('st_file').files[0];
  if (!f) return toast('Hãy chọn file congtrinh_export.json trước.', 'err');
  var replace = document.getElementById('st_replace').checked;
  var reader = new FileReader();
  reader.onload = function(){
    var payload;
    try { payload = JSON.parse(reader.result); }
    catch (e){ return toast('File không phải JSON hợp lệ.', 'err'); }
    var n = ['partners','projects','advances','floors'].map(function(k){
      return (payload[k] || []).length + ' ' + k;
    }).join(', ');
    confirmDlg('Nạp dữ liệu',
      'Nạp <b>' + n + '</b>.<br>'
      + (replace ? '<b style="color:#D64545">Toàn bộ dữ liệu hiện có sẽ bị xóa trước khi nạp.</b>'
                 : 'Dữ liệu mới được nối thêm vào dữ liệu hiện có.'),
      function(){
        toast('Đang nạp…');
        call('apiImport', [payload, replace ? 'replace' : 'append']).then(function(r){
          closeDlg();
          return reloadAll().then(function(){
            toast('Đã nạp: ' + Object.keys(r).map(function(k){ return r[k] + ' ' + k; }).join(', '), 'ok');
          });
        }).catch(fail);
      }, 'danger');
  };
  reader.readAsText(f, 'utf-8');
}

/* ==================================================== HỘP THOẠI CHUNG

   Hai lớp DOM riêng biệt thay vì một lớp dùng chung: hộp thoại lồng (thêm tạm ứng,
   bảng tầng) mở ở lớp 2, nhờ vậy form công trình ở lớp 1 vẫn còn sống — người dùng
   gõ dở tên/diện tích rồi mở bảng tầng thì quay ra vẫn còn nguyên.
   `cfg.nested = true` -> mở ở lớp 2. closeDlg() luôn đóng lớp trên cùng.          */

function dlgIds(lvl){
  return lvl === 2
    ? { mask: 'mask2', dlg: 'dlg2', title: 'dlg2Title', body: 'dlg2Body', foot: 'dlg2Foot' }
    : { mask: 'mask', dlg: 'dlg', title: 'dlgTitle', body: 'dlgBody', foot: 'dlgFoot' };
}

function topLevel(){
  return document.getElementById('mask2').classList.contains('on') ? 2 : 1;
}

/** Cầm thanh tiêu đề kéo hộp thoại đi chỗ khác (chuột và cảm ứng). */
function dragDlg(dlgId){
  var dlg = document.getElementById(dlgId), head = dlg.querySelector('.dlghead');
  var sx = 0, sy = 0, bx = 0, by = 0, r0 = null, on = false;
  function pos(){ var m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(dlg.style.transform || ''); return m ? [+m[1], +m[2]] : [0, 0]; }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  head.addEventListener('pointerdown', function(e){
    if (e.button !== 0 || e.target.closest('.dlgx')) return;
    var p = pos(); bx = p[0]; by = p[1]; sx = e.clientX; sy = e.clientY; r0 = dlg.getBoundingClientRect(); on = true;
    try { head.setPointerCapture(e.pointerId); } catch (err) {}
    head.classList.add('dragging'); e.preventDefault();
  });
  head.addEventListener('pointermove', function(e){
    if (!on) return;
    // Vị trí mới của mép trái / mép trên; giữ thanh tiêu đề luôn trong màn hình để còn cầm kéo lại
    var left = clamp(r0.left + e.clientX - sx, 120 - r0.width, window.innerWidth - 120);
    var top = clamp(r0.top + e.clientY - sy, 0, window.innerHeight - 60);
    dlg.style.transform = 'translate(' + (bx + left - r0.left) + 'px,' + (by + top - r0.top) + 'px)';
  });
  function stop(){ on = false; head.classList.remove('dragging'); }
  head.addEventListener('pointerup', stop);
  head.addEventListener('pointercancel', stop);
  head.addEventListener('dblclick', function(e){ if (!e.target.closest('.dlgx')) dlg.style.transform = ''; });
}

function openDlg(cfg){
  var lvl = cfg.nested ? 2 : 1;
  var id = dlgIds(lvl);
  document.getElementById(id.dlg).classList.toggle('wide', !!cfg.wide);
  document.getElementById(id.title).innerHTML = cfg.title;
  document.getElementById(id.body).innerHTML = cfg.body;

  var foot = document.getElementById(id.foot);
  foot.innerHTML = '';
  var left = document.createElement('div');
  left.className = 'grow';
  foot.appendChild(left);
  cfg.buttons.forEach(function(b){
    var el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    el.textContent = b.label;
    el.onclick = b.act;
    foot.appendChild(el);
  });
  document.getElementById(id.dlg).style.transform = '';   // mỗi lần mở: về giữa màn hình
  document.getElementById(id.mask).classList.add('on');
}

function closeDlg(){
  var id = dlgIds(topLevel());
  document.getElementById(id.mask).classList.remove('on');
}

function confirmDlg(title, html, onOk, cls, nested){
  openDlg({
    nested: !!nested,
    title: title,
    body: '<p style="margin:0">' + html + '</p>',
    buttons: [
      { label: 'Hủy', act: closeDlg },
      { label: 'Đồng ý', cls: cls || 'danger', act: onOk },
    ],
  });
}

/* ==================================================== CÀI ĐẶT NHƯ ỨNG DỤNG (PWA)
   sw.js lưu sẵn giao diện trong máy -> lần sau mở ngay. Có bản mới thì tự tải lại một lần. */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  var hadSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(function(){});
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (hadSW && !window.__reloaded){ window.__reloaded = true; location.reload(); }
  });
}

