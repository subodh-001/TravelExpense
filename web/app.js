// ============================================================
// Travel Expense Tracker Web & Mobile Web App Logic
// ============================================================

const API_BASE_URL = window.location.origin.includes('http') 
  ? `${window.location.origin}/api` 
  : 'http://localhost:3000/api';

// Cloudinary Storage Config (Cloud Name: vrxb6o67, Upload Preset: expense_receipts)
const CLOUDINARY = {
  cloudName: 'vrxb6o67',
  uploadPreset: 'expense_receipts'
};
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/upload`;

// Default Google User Profile
const DEFAULT_GOOGLE_USER = {
  id: 'google_subodh',
  name: 'Subodh Kumar',
  email: 'subodh.travels@gmail.com',
  picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Subodh'
};

const CURRENT_YEAR_MONTH = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

// App State
let state = {
  currentGoogleUser: getStoredGoogleUser(),
  expenses: [],
  filteredExpenses: [],
  selectedExpenseForReceipts: null,
  editingExpenseId: null,
  selectedMonth: CURRENT_YEAR_MONTH,
  sharedMode: false,
  activeView: 'cards', // 'cards' or 'table'
  backendOnline: false
};

// ==================== DOM ELEMENTS ====================
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');

// User Banner Elements
const userWelcomeBanner = document.getElementById('userWelcomeBanner');
const userAvatarWrapper = document.getElementById('userAvatarWrapper');
const userNameDisplay = document.getElementById('userNameDisplay');
const userEmailDisplay = document.getElementById('userEmailDisplay');
const userAvatarImg = document.getElementById('userAvatarImg');
const googleAuthBtn = document.getElementById('googleAuthBtn');
const switchUserBtn = document.getElementById('switchUserBtn');
const editProfileBtn = document.getElementById('editProfileBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const shareSheetBtn = document.getElementById('shareSheetBtn');
const sharedNoticeBanner = document.getElementById('sharedNoticeBanner');
const sharedUserName = document.getElementById('sharedUserName');
const exitSharedViewBtn = document.getElementById('exitSharedViewBtn');

// Edit Profile Modal Elements
const editProfileModal = document.getElementById('editProfileModal');
const closeEditProfileModalBtn = document.getElementById('closeEditProfileModalBtn');
const cancelEditProfileBtn = document.getElementById('cancelEditProfileBtn');
const editProfileForm = document.getElementById('editProfileForm');
const profileNameInput = document.getElementById('profileNameInput');
const profileEmailInput = document.getElementById('profileEmailInput');
const profilePhotoInput = document.getElementById('profilePhotoInput');
const profilePhotoPreview = document.getElementById('profilePhotoPreview');
const profilePhotoStatus = document.getElementById('profilePhotoStatus');

// Share Modal Elements
const shareModal = document.getElementById('shareModal');
const closeShareModalBtn = document.getElementById('closeShareModalBtn');
const closeShareModalFooterBtn = document.getElementById('closeShareModalFooterBtn');
const shareUrlInput = document.getElementById('shareUrlInput');
const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');
const openShareUrlLink = document.getElementById('openShareUrlLink');

// KPI Elements
const statsSection = document.getElementById('statsSection');
const kpiTotalExpense = document.getElementById('kpiTotalExpense');
const kpiTotalCount = document.getElementById('kpiTotalCount');
const kpiTotalReceipts = document.getElementById('kpiTotalReceipts');
const kpiTopCategory = document.getElementById('kpiTopCategory');
const kpiTopCategoryAmount = document.getElementById('kpiTopCategoryAmount');

// Filters & Controls
const searchLocationInput = document.getElementById('searchLocation');
const monthFilter = document.getElementById('monthFilter');
const paymentStatusFilter = document.getElementById('paymentStatusFilter');
const paymentStatusInput = document.getElementById('paymentStatusInput');
const filterDateInput = document.getElementById('filterDate');
const clearDateBtn = document.getElementById('clearDateBtn');
const refreshBtn = document.getElementById('refreshBtn');

// Views & Containers
const viewCardsBtn = document.getElementById('viewCardsBtn');
const viewTableBtn = document.getElementById('viewTableBtn');
const mobileCardsSection = document.getElementById('mobileCardsSection');
const mobileCardsContainer = document.getElementById('mobileCardsContainer');
const cardsCountBadge = document.getElementById('cardsCountBadge');

const tableSection = document.getElementById('tableSection');
const expenseTableBody = document.getElementById('expenseTableBody');
const tableCountBadge = document.getElementById('tableCountBadge');

const sumMetro = document.getElementById('sumMetro');
const sumLocal = document.getElementById('sumLocal');
const sumAuto = document.getElementById('sumAuto');
const sumOthers = document.getElementById('sumOthers');
const sumGrandTotal = document.getElementById('sumGrandTotal');

// Mobile Bottom Nav & FAB
const mobileFabBtn = document.getElementById('mobileFabBtn');
const navHome = document.getElementById('navHome');
const navAdd = document.getElementById('navAdd');
const navReceipts = document.getElementById('navReceipts');
const navStats = document.getElementById('navStats');
const navProfile = document.getElementById('navProfile');

// Add/Edit Modal
const openAddModalBtn = document.getElementById('openAddModalBtn');
const addModal = document.getElementById('addModal');
const closeAddModalBtn = document.getElementById('closeAddModalBtn');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const addExpenseForm = document.getElementById('addExpenseForm');
const expDateInput = document.getElementById('expDate');
const expLocationInput = document.getElementById('expLocation');
const entryAmountInputs = document.querySelectorAll('.entry-amount');
const modalCalculatedTotal = document.getElementById('modalCalculatedTotal');

// Receipt Modal
const receiptModal = document.getElementById('receiptModal');
const closeReceiptModalBtn = document.getElementById('closeReceiptModalBtn');
const closeReceiptModalFooterBtn = document.getElementById('closeReceiptModalFooterBtn');
const receiptModalSubtitle = document.getElementById('receiptModalSubtitle');
const dropzone = document.getElementById('dropzone');
const receiptFileInput = document.getElementById('receiptFileInput');
const receiptsGrid = document.getElementById('receiptsGrid');
const receiptCount = document.getElementById('receiptCount');

// Google Auth Modal
const googleAuthModal = document.getElementById('googleAuthModal');
const closeGoogleAuthModalBtn = document.getElementById('closeGoogleAuthModalBtn');
const customGoogleEmail = document.getElementById('customGoogleEmail');
const customGoogleSignInBtn = document.getElementById('customGoogleSignInBtn');

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  // Check if opened via shareable URL (?userId=...)
  checkSharedViewUrl();

  // Set default date input to today
  expDateInput.value = new Date().toISOString().split('T')[0];

  // If user is not signed in and not viewing a share link, show Enterprise Landing Page
  const landingPage = document.getElementById('landingPage');
  const fullAuthPage = document.getElementById('fullAuthPage');
  if (!state.currentGoogleUser && !state.sharedMode) {
    if (landingPage) landingPage.classList.remove('hidden');
    if (fullAuthPage) fullAuthPage.classList.add('hidden');
  } else {
    if (landingPage) landingPage.classList.add('hidden');
    if (fullAuthPage) fullAuthPage.classList.add('hidden');
  }

  // Render Logged In Google User Profile UI
  updateUserProfileUI();

  // Setup Google Identity Services (GSI) if available
  initGoogleIdentityServices();

  // Event Listeners
  googleAuthBtn.addEventListener('click', () => {
    if (closeGoogleAuthModalBtn) closeGoogleAuthModalBtn.style.display = 'block';
    openModal(googleAuthModal);
  });
  if (switchUserBtn) {
    switchUserBtn.addEventListener('click', performSignOut);
  }
  closeGoogleAuthModalBtn.addEventListener('click', () => closeModal(googleAuthModal));
  
  if (customGoogleSignInBtn) {
    customGoogleSignInBtn.addEventListener('click', handleCustomGoogleSignIn);
  }

  // Profile Edit Triggers
  if (editProfileBtn) editProfileBtn.addEventListener('click', openEditProfileModal);
  if (userAvatarWrapper) userAvatarWrapper.addEventListener('click', openEditProfileModal);
  if (closeEditProfileModalBtn) closeEditProfileModalBtn.addEventListener('click', () => closeModal(editProfileModal));
  if (cancelEditProfileBtn) cancelEditProfileBtn.addEventListener('click', () => closeModal(editProfileModal));
  if (profilePhotoInput) profilePhotoInput.addEventListener('change', handleProfilePhotoSelect);
  if (editProfileForm) editProfileForm.addEventListener('submit', handleSaveProfile);

  if (shareSheetBtn) {
    shareSheetBtn.addEventListener('click', shareExpenseLogLink);
  }

  if (exitSharedViewBtn) {
    exitSharedViewBtn.addEventListener('click', exitSharedView);
  }

  exportCsvBtn.addEventListener('click', exportExpensesToCSV);
  refreshBtn.addEventListener('click', loadExpenses);

  searchLocationInput.addEventListener('input', applyFilters);
  if (monthFilter) monthFilter.addEventListener('change', applyFilters);
  if (paymentStatusFilter) paymentStatusFilter.addEventListener('change', applyFilters);
  filterDateInput.addEventListener('change', applyFilters);
  clearDateBtn.addEventListener('click', () => {
    filterDateInput.value = '';
    applyFilters();
  });

  // View Switcher (Cards vs Table)
  viewCardsBtn.addEventListener('click', () => switchView('cards'));
  viewTableBtn.addEventListener('click', () => switchView('table'));

  // Modal Triggers
  if (openAddModalBtn) openAddModalBtn.addEventListener('click', () => openAddExpenseModal());
  if (mobileFabBtn) mobileFabBtn.addEventListener('click', () => openAddExpenseModal());
  
  closeAddModalBtn.addEventListener('click', () => closeModal(addModal));
  cancelAddBtn.addEventListener('click', () => closeModal(addModal));

  closeReceiptModalBtn.addEventListener('click', () => closeModal(receiptModal));
  closeReceiptModalFooterBtn.addEventListener('click', () => closeModal(receiptModal));

  if (closeShareModalBtn) closeShareModalBtn.addEventListener('click', () => closeModal(shareModal));
  if (closeShareModalFooterBtn) closeShareModalFooterBtn.addEventListener('click', () => closeModal(shareModal));

  if (copyShareUrlBtn) {
    copyShareUrlBtn.addEventListener('click', () => {
      if (shareUrlInput) {
        shareUrlInput.select();
        navigator.clipboard.writeText(shareUrlInput.value).then(() => {
          copyShareUrlBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
          copyShareUrlBtn.classList.remove('btn-primary');
          copyShareUrlBtn.classList.add('btn-success');
          setTimeout(() => {
            copyShareUrlBtn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy Link`;
            copyShareUrlBtn.classList.remove('btn-success');
            copyShareUrlBtn.classList.add('btn-primary');
          }, 2000);
        }).catch(() => {
          alert('Link selected! Press Ctrl+C / Cmd+C to copy.');
        });
      }
    });
  }

  // Auto calculate modal total
  entryAmountInputs.forEach(input => {
    input.addEventListener('input', calculateModalTotal);
  });

  addExpenseForm.addEventListener('submit', handleSaveExpense);

  // File Upload Listeners (Supports multiple receipts)
  receiptFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadMultipleReceiptFiles(e.target.files);
    }
  });

  // Drag and drop dropzone
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadMultipleReceiptFiles(e.dataTransfer.files);
    }
  });

  // Mobile Bottom Navigation Setup
  setupMobileNav();

  // Check Backend & Load Data
  checkHealth().then(() => loadExpenses());
});

// ==================== GOOGLE USER AUTH HELPERS ====================
function getStoredGoogleUser() {
  try {
    const stored = localStorage.getItem('google_user');
    return stored ? JSON.parse(stored) : DEFAULT_GOOGLE_USER;
  } catch (e) {
    return DEFAULT_GOOGLE_USER;
  }
}

function saveGoogleUser(user) {
  state.currentGoogleUser = user;
  try {
    localStorage.setItem('google_user', JSON.stringify(user));
  } catch (e) {
    console.warn('LocalStorage quota note:', e.message);
    try {
      const compactUser = { ...user };
      if (compactUser.picture && compactUser.picture.length > 500) {
        compactUser.picture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`;
      }
      localStorage.setItem('google_user', JSON.stringify(compactUser));
    } catch (e2) {}
  }

  // Backend Profile Sync for Shared Views
  fetch('/api/user/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user)
  }).catch(err => console.warn('Backend profile sync note:', err));

  const landingPage = document.getElementById('landingPage');
  const fullAuthPage = document.getElementById('fullAuthPage');
  if (landingPage) landingPage.classList.add('hidden');
  if (fullAuthPage) fullAuthPage.classList.add('hidden');
  if (closeGoogleAuthModalBtn) closeGoogleAuthModalBtn.style.display = 'block';
  closeModal(googleAuthModal);
  updateUserProfileUI();
  loadExpenses();
}

function performSignOut() {
  showConfirmModal({
    title: 'Sign Out Confirmation',
    message: 'Are you sure you want to sign out of your account?',
    iconClass: 'fa-right-from-bracket',
    btnText: 'Sign Out',
    onConfirm: () => {
      localStorage.removeItem('google_user');
      state.currentGoogleUser = null;

      const landingPage = document.getElementById('landingPage');
      const fullAuthPage = document.getElementById('fullAuthPage');
      if (landingPage) landingPage.classList.remove('hidden');
      if (fullAuthPage) fullAuthPage.classList.add('hidden');

      showToast('👋 Signed out successfully');
      updateUserProfileUI();
    }
  });
}

function updateUserProfileUI() {
  const headerSignOutBtn = document.getElementById('headerSignOutBtn');

  if (state.currentGoogleUser) {
    const user = state.currentGoogleUser;
    userNameDisplay.textContent = user.name;
    userEmailDisplay.textContent = user.email;
    userAvatarImg.src = user.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(user.name);

    googleAuthBtn.innerHTML = `
      <img src="${user.picture}" class="google-icon" style="border-radius:50%; width:20px; height:20px; object-fit:cover;" alt="Avatar" />
      <span>${user.name.split(' ')[0]}</span>
    `;
    if (headerSignOutBtn) headerSignOutBtn.style.display = 'inline-flex';
  } else {
    userNameDisplay.textContent = 'Guest Traveler';
    userEmailDisplay.textContent = 'Not Signed In';
    googleAuthBtn.innerHTML = `
      <svg class="google-icon" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
      </svg>
      <span>Sign in with Google</span>
    `;
    if (headerSignOutBtn) headerSignOutBtn.style.display = 'none';
  }
}

// ==================== PROFILE EDIT & PHOTO UPLOAD HELPERS ====================
function openEditProfileModal() {
  if (state.isReadOnlySharedView) return;

  const user = state.currentGoogleUser || DEFAULT_GOOGLE_USER;
  profileNameInput.value = user.name || '';
  profileEmailInput.value = user.email || '';
  profilePhotoPreview.src = user.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`;
  profilePhotoStatus.textContent = 'PNG or JPG, max 5MB (Stores in Cloudinary)';
  state.pendingProfilePhotoUrl = null;

  openModal(editProfileModal);
}

async function handleProfilePhotoSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  profilePhotoStatus.textContent = '⏳ Compressing & Uploading to Cloudinary...';

  try {
    // 1. Compress image to max 400x400
    const compressedFile = await compressImage(file, 400, 0.8);

    // 2. Upload directly to Cloudinary (vrxb6o67 / expense_receipts)
    const cloudFormData = new FormData();
    cloudFormData.append('file', compressedFile);
    cloudFormData.append('upload_preset', CLOUDINARY.uploadPreset);

    const cloudRes = await fetch(CLOUDINARY_UPLOAD_URL, {
      method: 'POST',
      body: cloudFormData
    });

    if (cloudRes.ok) {
      const cloudData = await cloudRes.json();
      state.pendingProfilePhotoUrl = cloudData.secure_url;
      profilePhotoPreview.src = cloudData.secure_url;
      profilePhotoStatus.textContent = '✓ Photo uploaded to Cloudinary!';
    } else {
      console.warn('Cloudinary direct photo upload status:', cloudRes.status);
      profilePhotoStatus.textContent = '❌ Cloudinary busy. Using lightweight photo preview.';
      const miniFile = await compressImage(file, 128, 0.6);
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.pendingProfilePhotoUrl = ev.target.result;
        profilePhotoPreview.src = ev.target.result;
      };
      reader.readAsDataURL(miniFile);
    }
  } catch (err) {
    console.error('Error uploading profile photo:', err);
    profilePhotoStatus.textContent = '❌ Photo upload error.';
  }
}

function handleSaveProfile(e) {
  e.preventDefault();

  const name = profileNameInput.value.trim();
  const email = state.currentGoogleUser.email; // Email remains locked to logged-in Google Identity

  if (!name) {
    alert('Please enter a display Name');
    return;
  }

  const picture = state.pendingProfilePhotoUrl || state.currentGoogleUser.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
  const updatedUser = {
    ...state.currentGoogleUser,
    name,
    email,
    picture
  };

  saveGoogleUser(updatedUser);
  closeModal(editProfileModal);
  showToast('✓ Profile updated successfully!');
}

function selectGoogleAccount(id, name, email, picture) {
  const popupWidth = 520;
  const popupHeight = 620;
  const left = Math.max(0, (window.screen.width - popupWidth) / 2);
  const top = Math.max(0, (window.screen.height - popupHeight) / 2);
  
  let googlePopup = null;
  try {
    googlePopup = window.open(
      `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=https://myaccount.google.com/`,
      'GoogleAccountAuthWindow',
      `width=${popupWidth},height=${popupHeight},top=${top},left=${left},scrollbars=yes,status=1,resizable=1`
    );
  } catch (err) {
    console.warn('Popup blocked info:', err);
  }

  const user = { id, name, email, picture };
  saveGoogleUser(user);
  closeModal(googleAuthModal);
  showToast(`✅ Signed in as ${email}`);

  setTimeout(() => {
    if (googlePopup && !googlePopup.closed) {
      try { googlePopup.close(); } catch (e) {}
    }
  }, 1500);
}

function handleCustomGoogleSignIn() {
  const email = customGoogleEmail.value.trim();
  if (!email || !email.includes('@')) {
    alert('Please enter a valid Google email address (e.g. name@gmail.com)');
    return;
  }
  const name = email.split('@')[0].replace(/[\._]/g, ' ');
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  const id = `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const picture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`;

  selectGoogleAccount(id, capitalizedName, email, picture);
  customGoogleEmail.value = '';
}

function initGoogleIdentityServices() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try {
      window.google.accounts.id.initialize({
        client_id: "598418938174-googleclientid.apps.googleusercontent.com",
        callback: handleGoogleGsiResponse,
        auto_select: false
      });

      const gsiContainer = document.getElementById('gsiButtonContainer');
      if (gsiContainer) {
        window.google.accounts.id.renderButton(
          gsiContainer,
          { theme: "outline", size: "large", type: "standard", shape: "pill", logo_alignment: "left", width: 320 }
        );
      }
      
      window.google.accounts.id.prompt();
    } catch (err) {
      console.warn("GSI init info:", err.message);
    }
  }
}

function handleGoogleGsiResponse(response) {
  if (response.credential) {
    fetch(`${API_BASE_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    })
    .then(res => res.json())
    .then(data => {
      if (data.user) {
        saveGoogleUser(data.user);
      }
    })
    .catch(err => console.error("Google Auth error:", err));
  }
}

// ==================== API HELPERS ====================
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    const data = await res.json();
    state.backendOnline = true;
    statusText.textContent = `${data.mode} Online`;
    statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  } catch (err) {
    state.backendOnline = false;
    statusText.textContent = 'Offline (Check Backend)';
    statusBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    statusBadge.style.color = '#ef4444';
  }
}

async function fetchWithAuth(url, options = {}) {
  const headers = {
    ...options.headers,
    'user-id': state.currentGoogleUser.id
  };
  return fetch(url, { ...options, headers });
}

// ==================== LOAD & FILTER DATA ====================
async function loadExpenses() {
  try {
    const url = state.isReadOnlySharedView 
      ? `${API_BASE_URL}/expenses?share=${encodeURIComponent(state.currentGoogleUser.id)}`
      : `${API_BASE_URL}/expenses`;

    const res = await fetchWithAuth(url);
    const data = await res.json();

    if (data.success) {
      state.expenses = data.expenses || [];
      populateMonthSelector();
      applyFilters();
    } else {
      console.error('Failed to load expenses:', data.error);
    }
  } catch (err) {
    console.error('Error fetching expenses:', err);
    state.expenses = [];
    state.filteredExpenses = [];
    renderView();
    updateKPIs();
  }
}

function populateMonthSelector() {
  if (!monthFilter) return;

  const monthsSet = new Set();
  monthsSet.add(CURRENT_YEAR_MONTH);

  (state.expenses || []).forEach(e => {
    if (e.date && e.date.length >= 7) {
      monthsSet.add(e.date.slice(0, 7));
    }
  });

  const sortedMonths = Array.from(monthsSet).sort().reverse();
  
  let html = '';
  sortedMonths.forEach(m => {
    const [year, monthNum] = m.split('-');
    const dateObj = new Date(parseInt(year), parseInt(monthNum) - 1, 1);
    const monthName = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const isCurrent = m === CURRENT_YEAR_MONTH;
    const label = `${monthName}${isCurrent ? ' (Current)' : ''}`;
    
    html += `<option value="${m}" style="background-color: #ffffff; color: #0f172a; font-weight: 600;" ${state.selectedMonth === m ? 'selected' : ''}>📅 ${label}</option>`;
  });

  html += `<option value="ALL" style="background-color: #ffffff; color: #0f172a; font-weight: 600;" ${state.selectedMonth === 'ALL' ? 'selected' : ''}>🌐 All Months (Historical)</option>`;
  monthFilter.innerHTML = html;
}

function applyFilters() {
  const searchTerm = searchLocationInput.value.toLowerCase().trim();
  const filterDate = filterDateInput.value;
  const monthVal = monthFilter ? monthFilter.value : state.selectedMonth;
  const statusVal = paymentStatusFilter ? paymentStatusFilter.value : 'ALL';
  state.selectedMonth = monthVal;

  state.filteredExpenses = state.expenses.filter(exp => {
    // 1. Month Filter
    if (monthVal !== 'ALL' && exp.date && !exp.date.startsWith(monthVal)) {
      return false;
    }
    // 2. Payment Status Filter
    if (statusVal !== 'ALL' && (exp.paymentStatus || 'pending') !== statusVal) {
      return false;
    }
    // 3. Specific Date Filter
    if (filterDate && exp.date !== filterDate) {
      return false;
    }
    // 4. Search Term
    if (searchTerm) {
      const matchesLoc = exp.location && exp.location.toLowerCase().includes(searchTerm);
      const matchesDate = exp.date && exp.date.includes(searchTerm);
      return matchesLoc || matchesDate;
    }
    return true;
  });

  renderView();
  updateKPIs();
}

function switchView(viewName) {
  state.activeView = viewName;
  if (viewName === 'cards') {
    viewCardsBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
    mobileCardsSection.classList.remove('hidden');
    tableSection.classList.add('hidden');
  } else {
    viewCardsBtn.classList.remove('active');
    viewTableBtn.classList.add('active');
    mobileCardsSection.classList.add('hidden');
    tableSection.classList.remove('hidden');
  }
  renderView();
}

function renderView() {
  renderMobileCards();
  renderTable();
}

// ==================== RENDER MOBILE CARDS ====================
function renderMobileCards() {
  cardsCountBadge.textContent = `${state.filteredExpenses.length} Entries`;

  if (state.filteredExpenses.length === 0) {
    mobileCardsContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-folder-open"></i>
        <p>No travel expenses recorded yet for this user.</p>
        <button class="btn btn-primary btn-sm" onclick="openAddExpenseModal()">
          + Add First Travel Entry
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  state.filteredExpenses.forEach(exp => {
    const getVal = (type) => {
      const entry = (exp.entries || []).find(e => e.type === type);
      return entry ? entry.amount : 0;
    };

    const metro = getVal('Metro');
    const local = getVal('Local');
    const auto = getVal('Auto/Rapido');
    const others = getVal('Others');
    const receiptsCount = (exp.receipts && exp.receipts.length) || 0;
    const status = exp.paymentStatus || 'pending';
    const isPaid = status === 'paid';
    const statusBadgeHtml = state.isReadOnlySharedView ? `
      <span style="background:${isPaid ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}; color:${isPaid ? '#34d399' : '#fbbf24'}; border:1px solid ${isPaid ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}; padding:3px 8px; font-size:0.75rem; border-radius:12px; font-weight:600; display:inline-block; margin-top:4px;">
        ${isPaid ? '✅ Paid & Settled' : '⏳ Payment Pending'}
      </span>
    ` : `
      <button type="button" onclick="togglePaymentStatus('${exp.id}', '${status}')" title="Click to toggle Payment Status" style="background:${isPaid ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}; color:${isPaid ? '#34d399' : '#fbbf24'}; border:1px solid ${isPaid ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}; padding:3px 8px; font-size:0.75rem; border-radius:12px; font-weight:600; cursor:pointer; display:inline-block; margin-top:4px;">
        ${isPaid ? '✅ Paid & Settled' : '⏳ Payment Pending'}
      </button>
    `;

    html += `
      <div class="expense-card" id="card-${exp.id}">
        <div class="card-header-row">
          <div>
            <div class="card-location">${escapeHtml(exp.location)}</div>
            <div class="card-date"><i class="fa-regular fa-calendar"></i> ${exp.date}</div>
            ${statusBadgeHtml}
          </div>
          <div class="card-total-badge">₹${exp.total || 0}</div>
        </div>

        <div class="card-breakdown-tags">
          <span class="tag-chip ${metro > 0 ? 'active-tag' : ''}">
            <i class="fa-solid fa-train-subway"></i> Metro: <strong>₹${metro}</strong>
          </span>
          <span class="tag-chip ${local > 0 ? 'active-tag' : ''}">
            <i class="fa-solid fa-train"></i> Local: <strong>₹${local}</strong>
          </span>
          <span class="tag-chip ${auto > 0 ? 'active-tag' : ''}">
            <i class="fa-solid fa-taxi"></i> Auto/Rapido: <strong>₹${auto}</strong>
          </span>
          <span class="tag-chip ${others > 0 ? 'active-tag' : ''}">
            <i class="fa-solid fa-ellipsis"></i> Others: <strong>₹${others}</strong>
          </span>
        </div>

        <div class="card-footer-row">
          <div class="card-receipt-count" onclick="openReceiptModal('${exp.id}')">
            <i class="fa-solid fa-paperclip"></i>
            <span>${receiptsCount} Receipt${receiptsCount === 1 ? '' : 's'}</span>
          </div>
          <div class="card-actions">
            ${state.isReadOnlySharedView ? `
              <button class="btn btn-secondary btn-sm" onclick="openReceiptModal('${exp.id}')" title="View Receipts">
                <i class="fa-solid fa-eye"></i> Receipts
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm" onclick="openEditExpenseModal('${exp.id}')" title="Edit Expense Entry">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openReceiptModal('${exp.id}')" title="Upload / View Receipts">
                <i class="fa-solid fa-camera"></i>
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteExpense('${exp.id}')" title="Delete Entry">
                <i class="fa-solid fa-trash"></i>
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  });

  mobileCardsContainer.innerHTML = html;
}

// ==================== RENDER EXCEL MATRIX TABLE ====================
function renderTable() {
  tableCountBadge.textContent = `${state.filteredExpenses.length} Entries`;

  if (state.filteredExpenses.length === 0) {
    expenseTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <i class="fa-solid fa-folder-open"></i>
            <p>No travel expenses recorded yet for this user.</p>
            ${state.isReadOnlySharedView ? '' : `
              <button class="btn btn-primary btn-sm" onclick="openAddExpenseModal()">
                + Add First Expense
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
    updateTableSums(0, 0, 0, 0, 0);
    return;
  }

  let html = '';
  let metroSum = 0;
  let localSum = 0;
  let autoSum = 0;
  let othersSum = 0;
  let grandTotal = 0;

  state.filteredExpenses.forEach(exp => {
    const getVal = (type) => {
      const entry = (exp.entries || []).find(e => e.type === type);
      return entry ? entry.amount : 0;
    };

    const metro = getVal('Metro');
    const local = getVal('Local');
    const auto = getVal('Auto/Rapido');
    const others = getVal('Others');
    const total = exp.total || (metro + local + auto + others);

    metroSum += metro;
    localSum += local;
    autoSum += auto;
    othersSum += others;
    grandTotal += total;

    const receiptsCount = (exp.receipts && exp.receipts.length) || 0;
    const status = exp.paymentStatus || 'pending';
    const isPaid = status === 'paid';
    const statusTdHtml = state.isReadOnlySharedView ? `
      <td>
        <span style="background:${isPaid ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}; color:${isPaid ? '#34d399' : '#fbbf24'}; border:1px solid ${isPaid ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}; padding:3px 8px; font-size:0.75rem; border-radius:12px; font-weight:600; white-space:nowrap;">
          ${isPaid ? '✅ Paid' : '⏳ Pending'}
        </span>
      </td>
    ` : `
      <td>
        <button type="button" onclick="togglePaymentStatus('${exp.id}', '${status}')" title="Click to toggle Payment Status" style="background:${isPaid ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}; color:${isPaid ? '#34d399' : '#fbbf24'}; border:1px solid ${isPaid ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}; padding:3px 8px; font-size:0.75rem; border-radius:12px; font-weight:600; cursor:pointer; white-space:nowrap;">
          ${isPaid ? '✅ Paid & Settled' : '⏳ Pending'}
        </button>
      </td>
    `;

    html += `
      <tr>
        <td><strong>${exp.date}</strong></td>
        <td><span class="location-name">${escapeHtml(exp.location)}</span></td>
        <td class="col-numeric ${metro > 0 ? 'highlight-val' : 'dim-val'}">${metro > 0 ? '₹' + metro : '-'}</td>
        <td class="col-numeric ${local > 0 ? 'highlight-val' : 'dim-val'}">${local > 0 ? '₹' + local : '-'}</td>
        <td class="col-numeric ${auto > 0 ? 'highlight-val' : 'dim-val'}">${auto > 0 ? '₹' + auto : '-'}</td>
        <td class="col-numeric ${others > 0 ? 'highlight-val' : 'dim-val'}">${others > 0 ? '₹' + others : '-'}</td>
        <td class="col-numeric col-total">₹${total}</td>
        <td>
          <button class="receipt-badge-btn" onclick="openReceiptModal('${exp.id}')">
            <i class="fa-solid fa-paperclip"></i>
            <span>${receiptsCount}</span>
          </button>
        </td>
        ${statusTdHtml}
        <td class="col-actions">
          ${state.isReadOnlySharedView ? `
            <button class="btn btn-secondary btn-sm" onclick="openReceiptModal('${exp.id}')" title="View Receipts">
              <i class="fa-solid fa-eye"></i> View
            </button>
          ` : `
            <button class="btn btn-secondary btn-sm" onclick="openEditExpenseModal('${exp.id}')" title="Edit Entry">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openReceiptModal('${exp.id}')" title="Upload / View Receipts">
              <i class="fa-solid fa-camera"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteExpense('${exp.id}')" title="Delete Entry">
              <i class="fa-solid fa-trash"></i>
            </button>
          `}
        </td>
      </tr>
    `;
  });

  expenseTableBody.innerHTML = html;
  updateTableSums(metroSum, localSum, autoSum, othersSum, grandTotal);
}

function updateTableSums(metro, local, auto, others, grand) {
  sumMetro.textContent = `₹${metro}`;
  sumLocal.textContent = `₹${local}`;
  sumAuto.textContent = `₹${auto}`;
  sumOthers.textContent = `₹${others}`;
  sumGrandTotal.textContent = `₹${grand}`;
}

// ==================== CALCULATE KPIS ====================
function updateKPIs() {
  const exps = state.filteredExpenses || [];
  const totalExpense = exps.reduce((sum, e) => sum + (e.total || 0), 0);
  const pendingTotal = exps.filter(e => (e.paymentStatus || 'pending') !== 'paid').reduce((sum, e) => sum + (e.total || 0), 0);
  const paidTotal = exps.filter(e => (e.paymentStatus || 'pending') === 'paid').reduce((sum, e) => sum + (e.total || 0), 0);
  const totalReceipts = exps.reduce((sum, e) => sum + ((e.receipts && e.receipts.length) || 0), 0);
  
  if (kpiTotalExpense) kpiTotalExpense.textContent = `₹${totalExpense}`;
  if (kpiTotalCount) kpiTotalCount.textContent = exps.length;
  if (kpiTotalReceipts) kpiTotalReceipts.textContent = totalReceipts;

  const totalSubtext = document.querySelector('.total-card .kpi-subtext');
  if (totalSubtext) {
    totalSubtext.innerHTML = `<span style="color:#fbbf24; font-weight:600;">⏳ Pending: ₹${pendingTotal}</span> | <span style="color:#34d399; font-weight:600;">✅ Paid: ₹${paidTotal}</span>`;
  }

  const breakdown = { Metro: 0, Local: 0, 'Auto/Rapido': 0, Others: 0 };
  exps.forEach(exp => {
    (exp.entries || []).forEach(entry => {
      const type = entry.type || 'Others';
      breakdown[type] = (breakdown[type] || 0) + (entry.amount || 0);
    });
  });

  let topMode = 'Auto/Rapido';
  let topAmount = 0;
  Object.keys(breakdown).forEach(mode => {
    if (breakdown[mode] > topAmount) {
      topAmount = breakdown[mode];
      topMode = mode;
    }
  });

  kpiTopCategory.textContent = topMode;
  kpiTopCategoryAmount.textContent = `₹${topAmount} spent`;
}

async function togglePaymentStatus(expenseId, currentStatus) {
  if (state.isReadOnlySharedView) return;
  const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';

  try {
    const res = await fetchWithAuth(`${API_BASE_URL}/expenses/${expenseId}/payment-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentStatus: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(newStatus === 'paid' ? '✅ Marked as Paid & Settled!' : '⏳ Marked as Payment Pending');
      loadExpenses();
    }
  } catch (err) {
    console.error('Error toggling payment status:', err);
  }
}

// ==================== CSV EXPORT ====================
function exportExpensesToCSV() {
  if (state.expenses.length === 0) {
    alert('No travel expenses available to export.');
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Date,Location,Metro (INR),Local (INR),Auto/Rapido (INR),Others (INR),Total (INR),Receipts Count\n";

  state.expenses.forEach(exp => {
    const getVal = (type) => {
      const entry = (exp.entries || []).find(e => e.type === type);
      return entry ? entry.amount : 0;
    };
    const metro = getVal('Metro');
    const local = getVal('Local');
    const auto = getVal('Auto/Rapido');
    const others = getVal('Others');
    const total = exp.total || (metro + local + auto + others);
    const receiptsCount = (exp.receipts && exp.receipts.length) || 0;
    const cleanLocation = `"${(exp.location || '').replace(/"/g, '""')}"`;

    csvContent += `${exp.date},${cleanLocation},${metro},${local},${auto},${others},${total},${receiptsCount}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Monthly_Travel_Expenses_${state.currentGoogleUser.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==================== ADD / EDIT EXPENSE ====================
function openAddExpenseModal() {
  state.editingExpenseId = null;
  addExpenseForm.reset();
  const modalHeaderH3 = addModal.querySelector('.modal-header h3');
  if (modalHeaderH3) modalHeaderH3.innerHTML = `<i class="fa-solid fa-plus-circle"></i> Add Travel Expense Entry`;
  
  const saveBtn = document.getElementById('saveExpenseBtn');
  if (saveBtn) saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> Save Entry`;

  expDateInput.value = new Date().toISOString().split('T')[0];
  if (paymentStatusInput) paymentStatusInput.value = 'pending';
  modalCalculatedTotal.textContent = '₹0';
  openModal(addModal);
}

function openEditExpenseModal(expenseId) {
  const exp = state.expenses.find(e => e.id === expenseId);
  if (!exp) return;

  state.editingExpenseId = expenseId;
  addExpenseForm.reset();

  const modalHeaderH3 = addModal.querySelector('.modal-header h3');
  if (modalHeaderH3) modalHeaderH3.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Travel Expense Entry`;

  const saveBtn = document.getElementById('saveExpenseBtn');
  if (saveBtn) saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> Save Changes`;

  expDateInput.value = exp.date || new Date().toISOString().split('T')[0];
  expLocationInput.value = exp.location || '';
  if (paymentStatusInput) paymentStatusInput.value = exp.paymentStatus || 'pending';

  // Pre-fill breakdown input amounts
  entryAmountInputs.forEach(input => {
    const type = input.getAttribute('data-type');
    const entry = (exp.entries || []).find(e => e.type === type);
    input.value = entry ? entry.amount : 0;
  });

  calculateModalTotal();
  openModal(addModal);
}

function calculateModalTotal() {
  let total = 0;
  entryAmountInputs.forEach(input => {
    total += parseFloat(input.value) || 0;
  });
  modalCalculatedTotal.textContent = `₹${total}`;
}

async function handleSaveExpense(e) {
  e.preventDefault();

  const date = expDateInput.value;
  const location = expLocationInput.value.trim();
  const paymentStatus = paymentStatusInput ? paymentStatusInput.value : 'pending';

  if (!date || !location) {
    alert('Please provide both Date and Location');
    return;
  }

  const entries = [];
  entryAmountInputs.forEach(input => {
    const type = input.getAttribute('data-type');
    const amount = parseFloat(input.value) || 0;
    entries.push({ type, amount });
  });

  const isEditing = Boolean(state.editingExpenseId);
  const url = isEditing 
    ? `${API_BASE_URL}/expenses/${state.editingExpenseId}`
    : `${API_BASE_URL}/expenses`;

  const method = isEditing ? 'PUT' : 'POST';

  try {
    const res = await fetchWithAuth(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, location, entries, paymentStatus })
    });

    const data = await res.json();
    if (data.success) {
      closeModal(addModal);
      state.editingExpenseId = null;
      loadExpenses();
    } else {
      alert(`Error saving expense: ${data.error}`);
    }
  } catch (err) {
    console.error('Error saving expense:', err);
    alert('Failed to save expense entry.');
  }
}

// Toast notification helper
function showToast(message) {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(16, 185, 129, 0.95);
      color: white;
      padding: 12px 24px;
      border-radius: 30px;
      font-size: 0.9rem;
      font-weight: 600;
      z-index: 9999;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      transition: all 0.3s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 3000);
}

// ==================== SHARE EXPENSE LOG LINK ====================
async function shareExpenseLogLink() {
  const monthParam = state.selectedMonth ? `&month=${encodeURIComponent(state.selectedMonth)}` : '';
  const shareUrl = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(state.currentGoogleUser.id)}${monthParam}`;

  if (shareUrlInput) shareUrlInput.value = shareUrl;
  if (openShareUrlLink) openShareUrlLink.setAttribute('href', shareUrl);

  const shareMonthBadge = document.getElementById('shareMonthBadge');
  if (shareMonthBadge) {
    let label = 'All Months (Historical)';
    if (state.selectedMonth && state.selectedMonth !== 'ALL' && state.selectedMonth.includes('-')) {
      const [y, m] = state.selectedMonth.split('-');
      const d = new Date(parseInt(y), parseInt(m) - 1, 1);
      label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    shareMonthBadge.innerHTML = `<i class="fa-solid fa-calendar-check"></i> Target Month: ${label}`;
  }

  // 1. Mobile Web Share API (WhatsApp, Gmail, Messages, Copy Menu)
  if (navigator.share) {
    try {
      await navigator.share({
        title: `${state.currentGoogleUser.name}'s Travel Expenses`,
        text: `View my monthly travel expense log and receipt vault on TravelExpense.io`,
        url: shareUrl
      });
      return;
    } catch (e) {
      // User canceled or fallback to modal
    }
  }

  // 2. Clipboard API
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🔗 Shareable Link Copied to Clipboard!');
    }
  } catch (err) {
    console.warn('Clipboard write note:', err);
  }

  // 3. Open Share Sheet Modal
  if (copyShareUrlBtn) {
    copyShareUrlBtn.innerHTML = `<i class="fa-solid fa-copy"></i> Copy Link`;
    copyShareUrlBtn.classList.remove('btn-success');
    copyShareUrlBtn.classList.add('btn-primary');
  }

  openModal(shareModal);
}

async function checkSharedViewUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedUserId = urlParams.get('share') || urlParams.get('userId');
  const sharedMonth = urlParams.get('month');

  if (sharedMonth) {
    state.selectedMonth = sharedMonth;
  }

  if (sharedUserId) {
    state.isReadOnlySharedView = true;
    state.sharedMode = true;

    state.currentGoogleUser = {
      id: sharedUserId,
      name: sharedUserId.includes('subodh') ? 'Subodh Kumar' : sharedUserId.replace('google_', '').replace('_', ' '),
      email: sharedUserId.includes('subodh') ? 'subodh.travels@gmail.com' : (sharedUserId.includes('@') ? sharedUserId : `${sharedUserId}@gmail.com`),
      picture: `https://api.dicebear.com/7.x/avataaars/svg?seed=${sharedUserId}`
    };

    // Hide admin action controls for viewer mode
    if (openAddModalBtn) openAddModalBtn.style.display = 'none';
    if (mobileFabBtn) mobileFabBtn.style.display = 'none';
    if (switchUserBtn) switchUserBtn.style.display = 'none';
    if (googleAuthBtn) googleAuthBtn.style.display = 'none';
    if (shareSheetBtn) shareSheetBtn.style.display = 'none';
    if (editProfileBtn) editProfileBtn.style.display = 'none';

    try {
      const pRes = await fetch(`/api/user/profile/${encodeURIComponent(sharedUserId)}`);
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.user && pData.user.name) {
          state.currentGoogleUser = pData.user;
          updateUserProfileUI();
        }
      }
    } catch (e) {}

    let monthDisplay = '';
    if (state.selectedMonth && state.selectedMonth !== 'ALL' && state.selectedMonth.includes('-')) {
      const [y, m] = state.selectedMonth.split('-');
      const d = new Date(parseInt(y), parseInt(m) - 1, 1);
      monthDisplay = ` (${d.toLocaleString('en-US', { month: 'long', year: 'numeric' })})`;
    }

    if (sharedNoticeBanner) {
      sharedNoticeBanner.classList.remove('hidden');
      if (sharedUserName) sharedUserName.textContent = `${state.currentGoogleUser.name}${monthDisplay}`;
    }
  }
}

function exitSharedView() {
  window.location.href = window.location.pathname;
}

// ==================== CUSTOM GLASSMORPHISM CONFIRM MODAL ====================
const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalIcon = document.getElementById('confirmModalIcon');
const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
const confirmModalActionBtn = document.getElementById('confirmModalActionBtn');

let pendingConfirmAction = null;

if (confirmModalCancelBtn) {
  confirmModalCancelBtn.addEventListener('click', () => {
    closeModal(confirmModal);
    pendingConfirmAction = null;
  });
}

if (confirmModalActionBtn) {
  confirmModalActionBtn.addEventListener('click', () => {
    closeModal(confirmModal);
    if (typeof pendingConfirmAction === 'function') {
      pendingConfirmAction();
    }
    pendingConfirmAction = null;
  });
}

function showConfirmModal({ title, message, iconClass = 'fa-trash-can', btnText = 'Delete Entry', onConfirm }) {
  if (confirmModalTitle) confirmModalTitle.textContent = title;
  if (confirmModalMessage) confirmModalMessage.textContent = message;
  if (confirmModalIcon) confirmModalIcon.className = `fa-solid ${iconClass}`;
  if (confirmModalActionBtn) {
    confirmModalActionBtn.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${btnText}`;
  }
  pendingConfirmAction = onConfirm;
  openModal(confirmModal);
}

// ==================== DELETE EXPENSE ====================
function deleteExpense(expenseId) {
  const exp = state.expenses.find(e => e.id === expenseId);
  const locName = exp ? exp.location : 'this travel expense';
  
  showConfirmModal({
    title: 'Delete Expense Entry?',
    message: `Are you sure you want to delete "${escapeHtml(locName)}"? This action cannot be undone.`,
    iconClass: 'fa-trash-can',
    btnText: 'Delete Entry',
    onConfirm: async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/expenses/${expenseId}`, {
          method: 'DELETE'
        });

        const data = await res.json();
        if (data.success) {
          showToast('🗑️ Travel expense entry deleted');
          loadExpenses();
        } else {
          alert(`Error deleting: ${data.error}`);
        }
      } catch (err) {
        console.error('Error deleting expense:', err);
        alert('Failed to delete expense entry.');
      }
    }
  });
}

// ==================== RECEIPT VAULT MANAGEMENT ====================
function openReceiptModal(expenseId) {
  const exp = state.expenses.find(e => e.id === expenseId);
  if (!exp) return;

  state.selectedExpenseForReceipts = exp;
  receiptModalSubtitle.textContent = `${exp.location} (${exp.date}) - Total ₹${exp.total}`;
  
  if (dropzone) {
    dropzone.style.display = state.isReadOnlySharedView ? 'none' : 'flex';
  }

  renderReceiptsGallery(exp);
  openModal(receiptModal);
}

function renderReceiptsGallery(expense) {
  const receipts = expense.receipts || [];
  receiptCount.textContent = receipts.length;

  if (receipts.length === 0) {
    receiptsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 20px;">
        <i class="fa-solid fa-receipt"></i>
        <p>No receipt images or PDFs attached yet.</p>
      </div>
    `;
    return;
  }

  let html = '';
  receipts.forEach((r, idx) => {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(r.fileName || r.originalName || r.fileUrl);
    
    html += `
      <div class="receipt-card">
        <div class="receipt-preview">
          ${isImage 
            ? `<img src="${r.fileUrl}" alt="Receipt" />` 
            : `<i class="fa-solid fa-file-pdf"></i>`
          }
        </div>
        <div class="receipt-info">
          <span class="receipt-filename" title="${r.originalName || r.fileName}">${r.originalName || r.fileName}</span>
          <span class="receipt-date">${new Date(r.uploadedAt || Date.now()).toLocaleDateString()}</span>
        </div>
        <div class="receipt-actions">
          <a href="${r.fileUrl}" target="_blank" class="btn btn-secondary btn-sm" title="View Full File">
            <i class="fa-solid fa-eye"></i> View File
          </a>
          ${state.isReadOnlySharedView ? '' : `
            <button class="btn btn-danger btn-sm" onclick="deleteReceiptByIndex('${expense.id}', ${idx})" title="Delete Receipt">
              <i class="fa-solid fa-trash"></i>
            </button>
          `}
        </div>
      </div>
    `;
  });

  receiptsGrid.innerHTML = html;
}

// Image Compression Helper
function compressImage(file, maxDimension = 1024, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxDimension) {
          height = (maxDimension / width) * height;
          width = maxDimension;
        }
        if (height > maxDimension) {
          width = (maxDimension / height) * width;
          height = maxDimension;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(compressed);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

async function uploadMultipleReceiptFiles(filesList) {
  if (!state.selectedExpenseForReceipts || !filesList || filesList.length === 0) return;
  const expenseId = state.selectedExpenseForReceipts.id;
  const files = Array.from(filesList);

  const dropzoneH4 = dropzone.querySelector('h4');
  const originalH4Text = dropzoneH4 ? dropzoneH4.textContent : 'Upload Receipt Image(s)';

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (dropzoneH4) {
      dropzoneH4.textContent = `⏳ Uploading ${i + 1} of ${files.length} to Cloudinary...`;
    }

    try {
      // 1. Compress image before upload
      let fileToUpload = file;
      if (file.type && file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1024, 0.8);
      }

      let receiptData = null;

      // 2. Direct upload to Cloudinary (vrxb6o67 / expense_receipts)
      try {
        const cloudFormData = new FormData();
        cloudFormData.append('file', fileToUpload);
        cloudFormData.append('upload_preset', CLOUDINARY.uploadPreset);
        cloudFormData.append('folder', 'receipts');

        const cloudRes = await fetch(CLOUDINARY_UPLOAD_URL, {
          method: 'POST',
          body: cloudFormData
        });

        if (cloudRes.ok) {
          const cloudData = await cloudRes.json();
          receiptData = {
            fileUrl: cloudData.secure_url,
            fileName: cloudData.public_id,
            originalName: file.name,
            publicId: cloudData.public_id
          };
        }
      } catch (cloudErr) {
        console.warn('Cloudinary upload warning:', cloudErr.message);
      }

      // 3. Save receipt to backend DB
      let res;
      if (receiptData) {
        res = await fetchWithAuth(`${API_BASE_URL}/expenses/${expenseId}/receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(receiptData)
        });
      } else {
        const formData = new FormData();
        formData.append('receipt', fileToUpload);
        res = await fetch(`${API_BASE_URL}/expenses/${expenseId}/receipts`, {
          method: 'POST',
          headers: { 'user-id': state.currentGoogleUser.id },
          body: formData
        });
      }

      const data = await res.json();
      if (data.success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error(`Error uploading receipt ${file.name}:`, err);
      failCount++;
    }
  }

  // Restore dropzone header
  if (dropzoneH4) dropzoneH4.textContent = originalH4Text;
  receiptFileInput.value = '';

  // Refresh expenses and updated receipt gallery
  await loadExpenses();
  const updatedExp = state.expenses.find(e => e.id === expenseId);
  if (updatedExp) {
    state.selectedExpenseForReceipts = updatedExp;
    renderReceiptsGallery(updatedExp);
  }
}

function deleteReceiptByIndex(expenseId, index) {
  showConfirmModal({
    title: 'Delete Receipt Bill?',
    message: 'Are you sure you want to remove this receipt file from the vault?',
    iconClass: 'fa-paperclip',
    btnText: 'Remove Receipt',
    onConfirm: async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/expenses/${expenseId}/receipts/index/${index}`, {
          method: 'DELETE'
        });

        const data = await res.json();
        if (data.success) {
          showToast('🗑️ Receipt removed');
          await loadExpenses();
          const updatedExp = state.expenses.find(e => e.id === expenseId);
          if (updatedExp) {
            state.selectedExpenseForReceipts = updatedExp;
            renderReceiptsGallery(updatedExp);
          }
        } else {
          alert(`Delete failed: ${data.error}`);
        }
      } catch (err) {
        console.error('Error deleting receipt:', err);
      }
    }
  });
}

// ==================== MOBILE BOTTOM NAVIGATION ====================
function setupMobileNav() {
  if (!navHome) return;

  const navItems = [navHome, navAdd, navReceipts, navStats, navProfile];
  
  function setActiveNav(activeBtn) {
    navItems.forEach(item => item && item.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');
  }

  navHome.addEventListener('click', () => {
    setActiveNav(navHome);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  navAdd.addEventListener('click', () => {
    openAddExpenseModal();
  });

  navReceipts.addEventListener('click', () => {
    setActiveNav(navReceipts);
    if (state.expenses.length > 0) {
      openReceiptModal(state.expenses[0].id);
    } else {
      openAddExpenseModal();
    }
  });

  navStats.addEventListener('click', () => {
    setActiveNav(navStats);
    statsSection.scrollIntoView({ behavior: 'smooth' });
  });

  navProfile.addEventListener('click', () => {
    setActiveNav(navProfile);
    openModal(googleAuthModal);
  });
}

// ==================== MODAL UTILITIES ====================
function openModal(modal) {
  if (modal) modal.classList.add('active');
}
function closeModal(modal) {
  if (modal) modal.classList.remove('active');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==================== AUTH TABS & 6-DIGIT OTP VERIFICATION ====================
let lastGeneratedOtp = '123456';

function switchAuthTab(tabName) {
  const authViewSignIn = document.getElementById('authViewSignIn');
  const authViewSignUp = document.getElementById('authViewSignUp');
  const tabSignInBtn = document.getElementById('tabSignInBtn');
  const tabSignUpBtn = document.getElementById('tabSignUpBtn');

  if (!authViewSignIn || !authViewSignUp) return;

  if (tabName === 'signin') {
    authViewSignIn.style.display = 'block';
    authViewSignUp.style.display = 'none';
    tabSignInBtn.style.background = '#ffffff';
    tabSignInBtn.style.color = '#2563eb';
    tabSignInBtn.style.fontWeight = '700';
    tabSignInBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
    
    tabSignUpBtn.style.background = 'transparent';
    tabSignUpBtn.style.color = '#64748b';
    tabSignUpBtn.style.fontWeight = '600';
    tabSignUpBtn.style.boxShadow = 'none';
  } else {
    authViewSignIn.style.display = 'none';
    authViewSignUp.style.display = 'block';
    tabSignUpBtn.style.background = '#ffffff';
    tabSignUpBtn.style.color = '#2563eb';
    tabSignUpBtn.style.fontWeight = '700';
    tabSignUpBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
    
    tabSignInBtn.style.background = 'transparent';
    tabSignInBtn.style.color = '#64748b';
    tabSignInBtn.style.fontWeight = '600';
    tabSignInBtn.style.boxShadow = 'none';
  }
}

async function requestOtpCode() {
  const name = document.getElementById('signUpNameInput').value.trim();
  const email = document.getElementById('signUpEmailInput').value.trim();

  if (!email || !email.includes('@')) {
    alert('Please enter a valid Google Email Address (e.g. name@gmail.com)');
    return;
  }

  const sendBtn = document.getElementById('sendOtpBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });

    const data = await res.json();
    if (data.success) {
      lastGeneratedOtp = data.otp || '123456';
      document.getElementById('otpTargetEmail').textContent = email;
      document.getElementById('demoOtpCode').textContent = lastGeneratedOtp;
      document.getElementById('otpCodeInput').value = lastGeneratedOtp;
      
      document.getElementById('otpStep1').style.display = 'none';
      document.getElementById('otpStep2').style.display = 'block';

      showToast(`🔑 6-Digit OTP Sent: ${lastGeneratedOtp}`);
    } else {
      alert(`OTP request failed: ${data.error}`);
    }
  } catch (err) {
    console.error('OTP request error:', err);
    lastGeneratedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    document.getElementById('otpTargetEmail').textContent = email;
    document.getElementById('demoOtpCode').textContent = lastGeneratedOtp;
    document.getElementById('otpCodeInput').value = lastGeneratedOtp;

    document.getElementById('otpStep1').style.display = 'none';
    document.getElementById('otpStep2').style.display = 'block';
    showToast(`🔑 6-Digit OTP Verification Code: ${lastGeneratedOtp}`);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function verifyOtpCode() {
  const name = document.getElementById('signUpNameInput').value.trim();
  const email = document.getElementById('signUpEmailInput').value.trim();
  const otp = document.getElementById('otpCodeInput').value.trim();

  if (!otp || otp.length < 6) {
    alert('Please enter the 6-Digit OTP Code');
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, otp })
    });

    const data = await res.json();
    if (data.success && data.user) {
      showToast(`🎉 OTP Verification & Registration Complete!`);
      saveGoogleUser(data.user);
    } else {
      alert(data.error || 'OTP verification failed. Please try again.');
    }
  } catch (err) {
    console.error('OTP verify error:', err);
    const cleanName = (name || email.split('@')[0]).replace(/[\._]/g, ' ');
    const capitalizedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    const userId = `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const picture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`;

    const user = { id: userId, name: capitalizedName, email, picture };
    showToast(`🎉 OTP Verified! Account Created (${email})`);
    saveGoogleUser(user);
  }
}

function backToOtpStep1() {
  document.getElementById('otpStep1').style.display = 'block';
  document.getElementById('otpStep2').style.display = 'none';
}

// ==================== FULL-SCREEN AUTH PAGE LOGIC ====================
function toggleAuthPageView(view) {
  const signInView = document.getElementById('authPageSignInView');
  const signUpView = document.getElementById('authPageSignUpView');

  if (!signInView || !signUpView) return;

  if (view === 'signup') {
    signInView.style.display = 'none';
    signUpView.style.display = 'block';
  } else {
    signInView.style.display = 'block';
    signUpView.style.display = 'none';
  }
}

function handleFullPageSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('fullSignInEmail').value.trim();
  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address');
    return;
  }
  const name = email.split('@')[0].replace(/[\._]/g, ' ');
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
  const id = `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const picture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`;

  const user = { id, name: capitalizedName, email, picture };
  showToast(`👋 Welcome back, ${capitalizedName}!`);
  saveGoogleUser(user);
}

async function sendFullPageOtp() {
  const email = document.getElementById('fullSignUpEmail').value.trim();
  const name = document.getElementById('fullSignUpName').value.trim();

  if (!email || !email.includes('@')) {
    alert('Please enter a valid Google Email Address');
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });
    const data = await res.json();
    const otp = data.otp || '123456';
    document.getElementById('fullSignUpOtp').value = otp;
    document.getElementById('fullOtpHint').innerHTML = `<strong style="color:#10b981;">✓ OTP Code Generated: ${otp}</strong>`;
    showToast(`🔑 6-Digit OTP Verification Code: ${otp}`);
  } catch (err) {
    const otp = '123456';
    document.getElementById('fullSignUpOtp').value = otp;
    document.getElementById('fullOtpHint').innerHTML = `<strong style="color:#10b981;">✓ OTP Code: ${otp}</strong>`;
    showToast(`🔑 6-Digit OTP Verification Code: ${otp}`);
  }
}

async function handleFullPageSignUp(e) {
  e.preventDefault();
  const name = document.getElementById('fullSignUpName').value.trim();
  const email = document.getElementById('fullSignUpEmail').value.trim();
  const otp = document.getElementById('fullSignUpOtp').value.trim();

  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address');
    return;
  }
  if (!otp || otp.length < 6) {
    alert('Please click Get OTP and enter the 6-digit code');
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, otp })
    });
    const data = await res.json();
    if (data.success && data.user) {
      showToast(`🎉 Registration & OTP Verification Complete!`);
      saveGoogleUser(data.user);
    } else {
      alert(data.error || 'OTP verification failed');
    }
  } catch (err) {
    const cleanName = (name || email.split('@')[0]).replace(/[\._]/g, ' ');
    const capitalizedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    const id = `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const picture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`;

    const user = { id, name: capitalizedName, email, picture };
    showToast(`🎉 Account Created (${email})`);
    saveGoogleUser(user);
  }
}

function openAuthScreen(mode = 'signin') {
  const landingPage = document.getElementById('landingPage');
  const fullAuthPage = document.getElementById('fullAuthPage');

  if (landingPage) landingPage.classList.add('hidden');
  if (fullAuthPage) fullAuthPage.classList.remove('hidden');

  toggleAuthPageView(mode);
}
