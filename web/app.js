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
  id: 'google_subodhram3350_gmail_com',
  name: 'Subodh Ram (Master Admin)',
  email: 'subodhram3350@gmail.com',
  role: 'super_admin',
  picture: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Subodh%20Ram%20(Master%20Admin)'
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

  // On page refresh: Stay on SuperAdmin or Dashboard if user is logged in; otherwise show Auth screen
  if (state.sharedMode || state.currentGoogleUser) {
    const u = state.currentGoogleUser;
    const isSuperAdmin = (u && (u.role === 'super_admin' || (u.email && u.email.toLowerCase().trim() === 'subodhram3350@gmail.com'))) || window.location.hash === '#superadmin';
    if (isSuperAdmin && !state.sharedMode && u) {
      switchAppPage('superadmin', false);
    } else {
      switchAppPage('dashboard', false);
    }
  } else {
    switchAppPage('auth', false);
    window.scrollTo(0, 0);
  }

  // Render Logged In Google User Profile UI
  updateUserProfileUI();

  // Setup Google Identity Services (GSI) if available
  initGoogleIdentityServices();

  // Event Listeners
  if (googleAuthBtn) {
    googleAuthBtn.addEventListener('click', () => {
      if (closeGoogleAuthModalBtn) closeGoogleAuthModalBtn.style.display = 'block';
      openModal(googleAuthModal);
    });
  }
  if (switchUserBtn) {
    switchUserBtn.addEventListener('click', performSignOut);
  }
  if (closeGoogleAuthModalBtn) {
    closeGoogleAuthModalBtn.addEventListener('click', () => closeModal(googleAuthModal));
  }
  
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

  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportExpensesToCSV);
  if (refreshBtn) refreshBtn.addEventListener('click', loadExpenses);

  if (searchLocationInput) searchLocationInput.addEventListener('input', applyFilters);
  if (monthFilter) monthFilter.addEventListener('change', applyFilters);
  if (paymentStatusFilter) paymentStatusFilter.addEventListener('change', applyFilters);
  if (filterDateInput) filterDateInput.addEventListener('change', applyFilters);
  if (clearDateBtn) {
    clearDateBtn.addEventListener('click', () => {
      if (filterDateInput) filterDateInput.value = '';
      applyFilters();
    });
  }

  // View Switcher (Cards vs Table)
  if (viewCardsBtn) viewCardsBtn.addEventListener('click', () => switchView('cards'));
  if (viewTableBtn) viewTableBtn.addEventListener('click', () => switchView('table'));

  // Modal Triggers
  if (openAddModalBtn) openAddModalBtn.addEventListener('click', () => openAddExpenseModal());
  if (mobileFabBtn) mobileFabBtn.addEventListener('click', () => openAddExpenseModal());
  
  if (closeAddModalBtn) closeAddModalBtn.addEventListener('click', () => closeModal(addModal));
  if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => closeModal(addModal));

  if (closeReceiptModalBtn) closeReceiptModalBtn.addEventListener('click', () => closeModal(receiptModal));
  if (closeReceiptModalFooterBtn) closeReceiptModalFooterBtn.addEventListener('click', () => closeModal(receiptModal));

  if (closeShareModalBtn) closeShareModalBtn.addEventListener('click', () => closeModal(shareModal));
  if (closeShareModalFooterBtn) closeShareModalFooterBtn.addEventListener('click', () => closeModal(shareModal));

  // Auto calculate modal total
  if (entryAmountInputs) {
    entryAmountInputs.forEach(input => {
      input?.addEventListener('input', calculateModalTotal);
    });
  }

  if (addExpenseForm) addExpenseForm.addEventListener('submit', handleSaveExpense);

  // File Upload Listeners (Supports multiple receipts)
  if (receiptFileInput) {
    receiptFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadMultipleReceiptFiles(e.target.files);
      }
    });
  }

  // Drag and drop dropzone
  if (dropzone) {
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
  }
  if (closeAddModalBtn) closeAddModalBtn.addEventListener('click', () => closeModal(addModal));
  if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => closeModal(addModal));
  if (addExpenseForm) addExpenseForm.addEventListener('submit', handleSaveExpense);

  if (closeReceiptModalBtn) closeReceiptModalBtn.addEventListener('click', () => closeModal(receiptModal));
  if (closeReceiptModalFooterBtn) closeReceiptModalFooterBtn.addEventListener('click', () => closeModal(receiptModal));

  if (viewCardsBtn) viewCardsBtn.addEventListener('click', () => switchView('cards'));
  if (viewTableBtn) viewTableBtn.addEventListener('click', () => switchView('table'));

  if (searchLocationInput) searchLocationInput.addEventListener('input', applyFilters);
  if (monthFilter) monthFilter.addEventListener('change', applyFilters);
  if (paymentStatusFilter) paymentStatusFilter.addEventListener('change', applyFilters);

  if (filterDateInput) filterDateInput.addEventListener('change', applyFilters);
  if (clearDateBtn) clearDateBtn.addEventListener('click', () => {
    if (filterDateInput) filterDateInput.value = '';
    applyFilters();
  });

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadExpenses());

  setupEntryCalculators();
});

// ==================== GOOGLE USER AUTH HELPERS ====================
function getStoredGoogleUser() {
  try {
    const stored = localStorage.getItem('google_user');
    let user = stored ? JSON.parse(stored) : DEFAULT_GOOGLE_USER;
    if (!user || !user.id || user.id === 'google_user' || user.id === 'user_123' || (user.email && user.email.toLowerCase().trim() === 'subodhram3350@gmail.com')) {
      user = DEFAULT_GOOGLE_USER;
      localStorage.setItem('google_user', JSON.stringify(DEFAULT_GOOGLE_USER));
    }
    return user;
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

  const isSuperAdmin = user && (user.role === 'super_admin' || (user.email && (user.email.toLowerCase() === 'subodhram3350@gmail.com' || user.email.toLowerCase().includes('admin'))));
  if (isSuperAdmin) {
    switchAppPage('superadmin');
  } else {
    switchAppPage('dashboard');
  }

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

      switchAppPage('landing');

      showToast('👋 Signed out successfully');
      updateUserProfileUI();
    }
  });
}

function toggleUserSideDrawer() {
  const drawer = document.getElementById('userSideDrawer');
  if (drawer) drawer.classList.toggle('hidden');
}

function scrollToUserEntries() {
  const sec = document.getElementById('userEntriesSection');
  if (sec) sec.scrollIntoView({ behavior: 'smooth' });
}

function updateUserProfileUI() {
  const headerSignOutBtn = document.getElementById('headerSignOutBtn');
  const welcomeName = document.getElementById('userWelcomeHeaderName');
  const drawerName = document.getElementById('drawerUserName');
  const drawerEmail = document.getElementById('drawerUserEmail');
  const drawerAvatar = document.getElementById('drawerUserAvatar');
  const adminToggleBtn = document.getElementById('adminPortalToggleBtn');
  const drawerAdminBtn = document.getElementById('drawerAdminBtn');

  if (state.currentGoogleUser) {
    const user = state.currentGoogleUser;
    if (userNameDisplay) userNameDisplay.textContent = user.name;
    if (userEmailDisplay) userEmailDisplay.textContent = user.email;
    if (userAvatarImg) userAvatarImg.src = user.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(user.name);

    if (welcomeName) welcomeName.textContent = user.name.split(' ')[0] || user.name;
    if (drawerName) drawerName.textContent = user.name;
    if (drawerEmail) drawerEmail.textContent = user.email;
    if (drawerAvatar) drawerAvatar.src = user.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(user.name);

    const isSuperAdmin = user.role === 'super_admin' || (user.email && user.email.toLowerCase().trim() === 'subodhram3350@gmail.com');
    if (adminToggleBtn) adminToggleBtn.style.display = isSuperAdmin ? 'inline-flex' : 'none';
    if (drawerAdminBtn) drawerAdminBtn.style.display = isSuperAdmin ? 'flex' : 'none';

    if (googleAuthBtn) {
      googleAuthBtn.innerHTML = `
        <img src="${user.picture}" class="google-icon" style="border-radius:50%; width:20px; height:20px; object-fit:cover;" alt="Avatar" />
        <span>${user.name.split(' ')[0]}</span>
      `;
    }
    if (headerSignOutBtn) headerSignOutBtn.style.display = 'inline-flex';
  } else {
    if (userNameDisplay) userNameDisplay.textContent = 'Guest Traveler';
    if (userEmailDisplay) userEmailDisplay.textContent = 'Not Signed In';
    if (googleAuthBtn) {
      googleAuthBtn.innerHTML = `
        <svg class="google-icon" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Sign in with Google</span>
      `;
    }
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
  const user = state.currentGoogleUser || getStoredGoogleUser();
  const userId = user ? user.id : DEFAULT_GOOGLE_USER.id;
  const headers = {
    'user-id': userId,
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

// ==================== LOAD & FILTER DATA ====================
async function loadExpenses() {
  if (!state.currentGoogleUser) {
    state.currentGoogleUser = getStoredGoogleUser();
  }
  try {
    const user = state.currentGoogleUser || DEFAULT_GOOGLE_USER;
    const url = `${API_BASE_URL}/expenses`;

    const res = await fetchWithAuth(url);
    const data = await res.json();

    if (data.success) {
      state.expenses = data.expenses || [];
      populateMonthSelector();
      applyFilters();
      renderUserEntriesList();
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
  const searchTerm = searchLocationInput ? searchLocationInput.value.toLowerCase().trim() : '';
  const filterDate = filterDateInput ? filterDateInput.value : '';
  const monthVal = monthFilter ? monthFilter.value : 'ALL';
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
      const matchesNotes = exp.notes && exp.notes.toLowerCase().includes(searchTerm);
      return matchesLoc || matchesDate || matchesNotes;
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
  renderUserEntriesList();
}

async function uploadFileToStorage(file) {
  if (!file) return '';
  try {
    const cloudFormData = new FormData();
    cloudFormData.append('file', file);
    cloudFormData.append('upload_preset', CLOUDINARY.uploadPreset);

    const cloudRes = await fetch(CLOUDINARY_UPLOAD_URL, {
      method: 'POST',
      body: cloudFormData
    });

    if (cloudRes.ok) {
      const cloudData = await cloudRes.json();
      if (cloudData.secure_url) {
        return cloudData.secure_url;
      }
    }
  } catch (cloudErr) {
    console.warn('Cloudinary upload fallback to Data URL:', cloudErr);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function handleUserPhotoSelect(e) {
  const file = e.target.files ? e.target.files[0] : null;
  const preview = document.getElementById('uploadedPhotoPreview');
  const nameEl = document.getElementById('uploadedPhotoName');
  if (file && preview && nameEl) {
    nameEl.textContent = file.name;
    preview.style.display = 'flex';
  }
}

async function handleUserSubmitExpense(e) {
  if (e) e.preventDefault();
  const itemCategory = document.getElementById('userItemSelect')?.value;
  const amountVal = parseFloat(document.getElementById('userAmountInput')?.value || '0');
  const commentVal = document.getElementById('userCommentInput')?.value.trim();
  const photoInput = document.getElementById('userPhotoFileInput');
  const btn = document.getElementById('userSubmitExpenseBtn');

  if (!itemCategory) {
    alert('Please select a travel item category');
    return;
  }
  if (!amountVal || amountVal <= 0) {
    alert('Please enter a valid amount');
    return;
  }

  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

  let receiptUrl = '';
  if (photoInput && photoInput.files && photoInput.files[0]) {
    try {
      receiptUrl = await uploadFileToStorage(photoInput.files[0]);
    } catch (err) {
      console.warn('Photo upload warning:', err);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const payload = {
    date: today,
    location: itemCategory,
    notes: commentVal || itemCategory,
    paymentStatus: 'pending',
    entries: [
      { type: itemCategory, amount: amountVal }
    ],
    receipts: receiptUrl ? [receiptUrl] : []
  };

  try {
    const res = await fetchWithAuth(`${API_BASE_URL}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.success) {
      showToast(`✅ Travel expense entry for ${itemCategory} (₹${amountVal}) submitted!`);
      const form = document.getElementById('handwrittenTravelForm');
      if (form) form.reset();
      const preview = document.getElementById('uploadedPhotoPreview');
      if (preview) preview.style.display = 'none';
      await loadExpenses();
    } else {
      alert(data.error || 'Failed to submit expense entry.');
    }
  } catch (err) {
    alert('Error submitting expense: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Travel Expense';
  }
}

function renderUserEntriesList() {
  const tbody = document.getElementById('userEntriesTableBody');
  const countBadge = document.getElementById('userEntriesCountBadge');
  const totalValEl = document.getElementById('userTotalSpentHeaderVal');
  if (!tbody) return;

  const userExpenses = state.expenses || [];
  if (countBadge) countBadge.textContent = `${userExpenses.length} Entries`;

  // Active pending amount (Becomes 0 when Admin pays/settles!)
  const pendingExpenses = userExpenses.filter(exp => exp.paymentStatus !== 'paid');
  const activePendingTotal = pendingExpenses.reduce((sum, exp) => sum + (exp.total || 0), 0);
  if (totalValEl) totalValEl.textContent = `₹${activePendingTotal.toLocaleString('en-IN')}`;

  if (userExpenses.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 32px; color: #64748b;">
          <i class="fa-solid fa-folder-open" style="font-size: 2rem; color: #94a3b8; margin-bottom: 8px; display: block;"></i>
          No uploaded travel entries yet. Fill out the form above to add your travel expenses.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = userExpenses.map(exp => {
    const isPaid = exp.paymentStatus === 'paid';
    const statusBadge = isPaid
      ? `<span style="background: #ecfdf5; color: #047857; border: 1px solid #d1fae5; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Paid</span>`
      : `<span style="background: #fffbeb; color: #b45309; border: 1px solid #fef3c7; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-clock"></i> Pending</span>`;

    let dateTimeDisplay = exp.date || new Date().toISOString().split('T')[0];
    if (exp.createdAt) {
      try {
        const d = new Date(exp.createdAt);
        const formattedDate = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const formattedTime = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        dateTimeDisplay = `<strong style="color: #0f172a; display: block;">${formattedDate}</strong><span style="font-size: 0.78rem; color: #64748b;"><i class="fa-regular fa-clock"></i> ${formattedTime}</span>`;
      } catch (e) {
        dateTimeDisplay = exp.date;
      }
    }

    const categoryItem = exp.location || (exp.entries && exp.entries[0] ? exp.entries[0].type : 'Travel Item');
    const receiptHtml = (exp.receipts && exp.receipts.length > 0)
      ? `<a href="${exp.receipts[0]}" target="_blank" style="color: #2563eb; font-weight: 700; font-size: 0.85rem; text-decoration: underline;"><i class="fa-solid fa-file-image"></i> View Receipt</a>`
      : `<span style="color: #94a3b8; font-size: 0.8rem;">No Photo</span>`;

    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 12px 16px; font-weight: 600; color: #334155; font-size: 0.88rem;">${dateTimeDisplay}</td>
        <td style="padding: 12px 16px; font-weight: 800; color: #0f172a; font-size: 0.92rem;">${categoryItem}</td>
        <td style="padding: 12px 16px; font-weight: 800; color: #0f172a; font-size: 0.98rem;" class="col-numeric">₹${(exp.total || 0).toLocaleString('en-IN')}</td>
        <td style="padding: 12px 16px; color: #64748b; font-size: 0.85rem;">${exp.notes || exp.comments || 'N/A'}</td>
        <td style="padding: 12px 16px;">${receiptHtml}</td>
        <td style="padding: 12px 16px;">${statusBadge}</td>
      </tr>
    `;
  }).join('');
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

// Elegant Custom Alert Modal System (replaces ugly browser alerts)
function customAlert(titleOrMsg, message = '') {
  const modal = document.getElementById('customAlertModal');
  if (!modal) {
    showToast(titleOrMsg + (message ? ': ' + message : ''));
    return;
  }

  let title = 'Notice';
  let bodyMsg = String(titleOrMsg || '');
  let iconClass = 'fa-circle-info';
  let iconColor = '#000000';
  let iconBg = '#f4f4f7';

  if (message) {
    title = String(titleOrMsg);
    bodyMsg = String(message);
  } else {
    const text = bodyMsg.toLowerCase();
    if (text.includes('password')) {
      title = 'Password Notice';
      iconClass = 'fa-key';
      iconColor = '#000000';
      iconBg = '#f4f4f7';
    } else if (text.includes('error') || text.includes('failed') || text.includes('invalid') || text.includes('cannot') || text.includes('offline') || text.includes('incorrect') || text.includes('no password')) {
      title = 'Authentication Notice';
      iconClass = 'fa-circle-exclamation';
      iconColor = '#ef4444';
      iconBg = '#fef2f2';
    } else if (text.includes('success') || text.includes('welcome') || text.includes('created') || text.includes('saved')) {
      title = 'Success';
      iconClass = 'fa-circle-check';
      iconColor = '#10b981';
      iconBg = '#ecfdf5';
    }
  }

  const iconEl = document.getElementById('customAlertIcon');
  const iconContainer = document.getElementById('customAlertIconContainer');
  const titleEl = document.getElementById('customAlertTitle');
  const msgEl = document.getElementById('customAlertMessage');

  if (iconEl) iconEl.className = `fa-solid ${iconClass}`;
  if (iconEl) iconEl.style.color = iconColor;
  if (iconContainer) iconContainer.style.background = iconBg;
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = bodyMsg;

  openModal(modal);

  const okBtn = document.getElementById('customAlertOkBtn');
  if (okBtn) {
    setTimeout(() => okBtn.focus(), 50);
    okBtn.onclick = () => closeModal(modal);
  }
}

// Override native window.alert globally
window.alert = function(msg) {
  customAlert(msg);
};

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
        text: `View my monthly travel expense log and receipt vault on TravelExpense`,
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
    tabSignInBtn.style.color = '#000000';
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
      const target = document.getElementById('otpTargetEmail');
      if (target) target.textContent = email;
      const input = document.getElementById('otpCodeInput');
      if (input) input.value = '';
      
      document.getElementById('otpStep1').style.display = 'none';
      document.getElementById('otpStep2').style.display = 'block';

      showToast(`✉️ 6-Digit OTP code sent to ${email}`);
    } else {
      customAlert(`OTP request failed: ${data.error}`);
    }
  } catch (err) {
    console.error('OTP request error:', err);
    showToast('❌ Server error requesting OTP');
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

  const signInEmail = document.getElementById('fullSignInEmail');
  const signUpEmail = document.getElementById('fullSignUpEmail');

  if (view === 'signup') {
    if (signInEmail && signUpEmail && signInEmail.value && !signUpEmail.value) {
      signUpEmail.value = signInEmail.value;
    }
    signInView.style.display = 'none';
    signUpView.style.display = 'block';
  } else {
    if (signUpEmail && signInEmail && signUpEmail.value && !signInEmail.value) {
      signInEmail.value = signUpEmail.value;
    }
    signInView.style.display = 'block';
    signUpView.style.display = 'none';
  }
}

async function sendFullSignInOtp() {
  const emailInput = document.getElementById('fullSignInEmail');
  const email = emailInput ? emailInput.value.trim() : '';

  if (!email || !email.includes('@')) {
    alert('Please enter your email address first');
    if (emailInput) emailInput.focus();
    return;
  }

  const passwordInput = document.getElementById('fullSignInPassword');
  const hintEl = document.getElementById('signInOtpHint');

  try {
    await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (hintEl) {
      hintEl.style.display = 'block';
      hintEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verification OTP code sent to <strong>${email}</strong>`;
    }
    showToast(`✉️ Verification code sent to ${email}`);
  } catch (err) {
    showToast('❌ Failed to send OTP');
  }
}

// ===== GOOGLE OTP 3-STEP FLOW =====
// State for the OTP flow
let googleOtpFlowEmail = '';
let googleOtpFlowIsExistingUser = false;

// Show a specific step panel
function showGoogleOtpStep(step) {
  const allPanels = ['authPageSignInView', 'authPageSignUpView', 'googleOtpStep1', 'googleOtpStep2', 'googleOtpStep3'];
  allPanels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('googleOtpStep' + step);
  if (target) target.style.display = 'block';
}

// Start Google OTP Flow - show Step 1
function startGoogleOtpFlow() {
  googleOtpFlowEmail = '';
  googleOtpFlowIsExistingUser = false;
  const emailInput = document.getElementById('googleOtpEmail');
  if (emailInput) emailInput.value = '';
  const hintEl = document.getElementById('googleOtpStep1Hint');
  if (hintEl) hintEl.innerHTML = '';
  showGoogleOtpStep(1);
  setTimeout(() => document.getElementById('googleOtpEmail')?.focus(), 100);
}

// Cancel Google OTP flow - go back to sign in
function cancelGoogleOtpFlow() {
  const allPanels = ['authPageSignInView', 'authPageSignUpView', 'googleOtpStep1', 'googleOtpStep2', 'googleOtpStep3'];
  allPanels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Show whichever view was active before
  const signInView = document.getElementById('authPageSignInView');
  if (signInView) signInView.style.display = 'block';
}

// Step 1: Send OTP to email
async function sendGoogleOtp(isResend = false) {
  const email = document.getElementById('googleOtpEmail')?.value.trim() || '';
  const hintEl = document.getElementById('googleOtpStep1Hint');
  const btnText = document.getElementById('sendOtpBtnText');

  if (!email || !email.includes('@')) {
    const errEl = document.getElementById('googleOtpEmailError');
    if (errEl) { errEl.textContent = 'Please enter a valid email address'; errEl.style.display = 'block'; }
    return;
  }

  googleOtpFlowEmail = email;
  if (btnText) btnText.textContent = 'Sending...';
  if (hintEl) hintEl.innerHTML = '<span style="color:#6e6e73">⏳ Sending verification code...</span>';

  try {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (!res.ok) {
      if (hintEl) hintEl.innerHTML = `<span style="color:#ef4444">❌ ${data.error || 'Failed to send code'}</span>`;
      if (btnText) btnText.textContent = 'Send Verification Code';
      return;
    }

    // Move to step 2
    const targetEl = document.getElementById('googleOtpTargetEmail');
    if (targetEl) targetEl.textContent = email;
    const codeInput = document.getElementById('googleOtpCode');
    if (codeInput) { codeInput.value = ''; }
    const step2Hint = document.getElementById('googleOtpStep2Hint');
    if (step2Hint) step2Hint.innerHTML = isResend ? '<span style="color:#10b981">✓ New code sent!</span>' : '';

    showGoogleOtpStep(2);
    setTimeout(() => document.getElementById('googleOtpCode')?.focus(), 100);
    showToast(`✉️ Verification code sent to ${email}`);
  } catch (err) {
    if (hintEl) hintEl.innerHTML = '<span style="color:#ef4444">❌ Server error. Make sure backend is running.</span>';
    if (btnText) btnText.textContent = 'Send Verification Code';
  }
}

// Step 2: Verify OTP code entered by user
async function verifyGoogleOtp() {
  const otp = document.getElementById('googleOtpCode')?.value.trim() || '';
  const codeErrEl = document.getElementById('googleOtpCodeError');
  const step2Hint = document.getElementById('googleOtpStep2Hint');
  const btnText = document.getElementById('verifyOtpBtnText');

  if (!otp || otp.length !== 6) {
    if (codeErrEl) { codeErrEl.textContent = 'Please enter the complete 6-digit code'; codeErrEl.style.display = 'block'; }
    return;
  }

  if (btnText) btnText.textContent = 'Verifying...';
  if (step2Hint) step2Hint.innerHTML = '<span style="color:#6e6e73">⏳ Verifying code...</span>';

  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: googleOtpFlowEmail, otp })
    });
    const data = await res.json();

    if (!res.ok) {
      if (codeErrEl) { codeErrEl.textContent = data.error || 'Invalid code. Try again.'; codeErrEl.style.display = 'block'; }
      if (step2Hint) step2Hint.innerHTML = '';
      if (btnText) btnText.textContent = 'Verify Code';
      return;
    }

    // OTP verified! Check if user already has a password set
    const user = data.user;
    googleOtpFlowIsExistingUser = !!data.hasPassword;

    if (data.hasPassword) {
      // Existing user with password → login directly
      showToast(`👋 Welcome back, ${user.name}!`);
      saveGoogleUser(user);
    } else {
      // New user → go to Step 3 setup
      const setupNameInput = document.getElementById('setupName');
      if (setupNameInput && user.name) setupNameInput.value = user.name;
      showGoogleOtpStep(3);
      setTimeout(() => document.getElementById('setupName')?.focus(), 100);
    }
  } catch (err) {
    if (codeErrEl) { codeErrEl.textContent = 'Server error. Please try again.'; codeErrEl.style.display = 'block'; }
    if (btnText) btnText.textContent = 'Verify Code';
  }
}

// Step 3: Complete account setup with name + password
async function completeGoogleSetup(e) {
  e.preventDefault();
  const name = document.getElementById('setupName')?.value.trim() || '';
  const password = document.getElementById('setupPassword')?.value.trim() || '';
  const confirmPwd = document.getElementById('setupConfirmPassword')?.value.trim() || '';

  if (!name) {
    const errEl = document.getElementById('setupNameError');
    if (errEl) { errEl.textContent = 'Please enter your display name'; errEl.style.display = 'block'; }
    return;
  }
  if (password.length < 6) {
    const errEl = document.getElementById('setupPasswordError');
    if (errEl) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; }
    return;
  }
  if (password !== confirmPwd) {
    const errEl = document.getElementById('setupConfirmError');
    if (errEl) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; }
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: googleOtpFlowEmail, password, name })
    });
    const data = await res.json();

    if (!res.ok) {
      const errEl = document.getElementById('setupPasswordError');
      if (errEl) { errEl.textContent = data.error || 'Setup failed'; errEl.style.display = 'block'; }
      return;
    }

    showToast(`🎉 Account created! Welcome, ${data.user.name}!`);
    saveGoogleUser(data.user);
  } catch (err) {
    alert('Failed to complete setup: ' + err.message);
  }
}

// ===== SIGN IN with Email + Password Only =====
async function handleFullPageSignIn(e) {
  e.preventDefault();
  const email = document.getElementById('fullSignInEmail')?.value.trim() || '';
  const password = document.getElementById('fullSignInPassword')?.value.trim() || '';

  if (!email || !email.includes('@')) {
    showFieldError('signInEmailError', 'Please enter a valid email address');
    return;
  }
  if (!password) {
    showFieldError('signInPasswordError', 'Please enter your password');
    return;
  }

  const submitBtn = document.querySelector('#fullSignInForm button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Signing in...';

  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Sign in failed. Please check your email and password.');
      if (submitBtn) submitBtn.textContent = 'Sign in';
      return;
    }

    showToast(`👋 Welcome back, ${data.user.name}!`);
    saveGoogleUser(data.user);
  } catch (err) {
    alert('Connection error: ' + err.message);
    if (submitBtn) submitBtn.textContent = 'Sign in';
  }
}

// Password visibility toggle
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
  } else {
    input.type = 'password';
    if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
  }
}

// Send OTP for Sign In view
async function sendFullSignInOtp() {
  const email = document.getElementById('fullSignInEmail')?.value.trim();
  const hintEl = document.getElementById('signInOtpHint');
  if (!email || !email.includes('@')) {
    alert('Please enter your Gmail address first');
    document.getElementById('fullSignInEmail')?.focus();
    return;
  }

  if (hintEl) { hintEl.style.display = 'block'; hintEl.innerHTML = '<span style="color:#6366f1">⏳ Sending OTP to Gmail...</span>'; }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      if (hintEl) hintEl.innerHTML = `<span style="color:#ef4444">${data.error || 'Failed to send OTP'}</span>`;
      return;
    }
    if (hintEl) hintEl.innerHTML = `<span style="color:#10b981">✓ 6-Digit OTP sent to ${email}! Check your Gmail inbox.</span>`;
    showToast(`✉️ 6-Digit OTP sent to ${email}`);
  } catch (err) {
    if (hintEl) hintEl.innerHTML = '<span style="color:#ef4444">Failed to send OTP email</span>';
  }
}

// Inline OTP flow for sign-up (shows OTP input row after sending)
async function handleSignUpOtpFlow() {
  const email = document.getElementById('fullSignUpEmail')?.value.trim();
  const name = document.getElementById('fullSignUpName')?.value.trim();
  const otpCodeInput = document.getElementById('fullSignUpOtpCode');
  const otpBtn = document.getElementById('sendOtpRowBtn');
  const hintEl = document.getElementById('fullOtpHint');

  if (!email || !email.includes('@')) {
    showFieldError('signUpEmailError', 'Please enter a valid email address first');
    document.getElementById('fullSignUpEmail')?.focus();
    return;
  }

  if (hintEl) hintEl.innerHTML = '<span style="color:#6366f1">⏳ Sending OTP to Gmail...</span>';
  try {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });
    const data = await res.json();
    if (!res.ok) {
      if (hintEl) hintEl.innerHTML = `<span style="color:#ef4444">${data.error || 'Failed to send OTP'}</span>`;
      return;
    }

    if (otpCodeInput) { otpCodeInput.style.display = 'block'; otpCodeInput.focus(); }
    if (otpBtn) { otpBtn.style.display = 'block'; otpBtn.textContent = 'Verify OTP'; }
    if (hintEl) hintEl.innerHTML = `<span style="color:#10b981">✓ 6-Digit OTP sent to ${email}. Check your Gmail.</span>`;
    showToast(`✉️ 6-Digit OTP sent to ${email}`);
  } catch (err) {
    if (hintEl) hintEl.innerHTML = '<span style="color:#ef4444">Failed to send OTP. Server offline.</span>';
  }
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { if (el) el.style.display = 'none'; }, 3500);
}

// ===== SIGN UP WITH OTP VERIFICATION =====
let signUpPendingEmail = '';
let signUpPendingName = '';
let signUpPendingPassword = '';

// Step 1: Validate fields and send OTP
async function handleSignUpStep1(e) {
  e.preventDefault();
  const name = document.getElementById('fullSignUpName')?.value.trim() || '';
  const email = document.getElementById('fullSignUpEmail')?.value.trim() || '';
  const password = document.getElementById('fullSignUpOtp')?.value.trim() || '';

  if (!email || !email.includes('@')) {
    showFieldError('signUpEmailError', 'Please enter a valid email address');
    return;
  }
  if (!password || password.length < 6) {
    showFieldError('signUpPasswordError', 'Password must be at least 6 characters');
    return;
  }

  signUpPendingEmail = email;
  signUpPendingName = name;
  signUpPendingPassword = password;

  const btn = document.getElementById('sendSignUpOtpBtn');
  if (btn) btn.querySelector('span').textContent = 'Checking...';

  try {
    // First check if email already registered
    const checkRes = await fetch(`${API_BASE_URL}/auth/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const checkData = await checkRes.json();

    if (checkData.exists) {
      // Email already registered — show clear error with sign in option
      const emailInput = document.getElementById('fullSignUpEmail');
      if (emailInput) {
        emailInput.style.borderColor = '#ef4444';
        emailInput.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.15)';
        setTimeout(() => {
          emailInput.style.borderColor = '';
          emailInput.style.boxShadow = '';
        }, 3000);
      }
      const errEl = document.getElementById('signUpEmailError');
      if (errEl) {
        errEl.innerHTML = `⚠️ This email is already registered. <a href="#" style="color:#000;font-weight:700;text-decoration:underline;" onclick="toggleAuthPageView('signin'); return false;">Sign in instead →</a>`;
        errEl.style.display = 'block';
      }
      if (btn) btn.querySelector('span').textContent = 'Continue';
      return;
    }

    // Email is new — send OTP
    if (btn) btn.querySelector('span').textContent = 'Sending code...';
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
    });
    const data = await res.json();

    if (!res.ok) {
      showFieldError('signUpEmailError', data.error || 'Failed to send verification code');
      if (btn) btn.querySelector('span').textContent = 'Continue';
      return;
    }

    // Show Step 2
    const targetEl = document.getElementById('signUpOtpTargetEmail');
    if (targetEl) targetEl.textContent = email;
    const codeInput = document.getElementById('signUpOtpCode');
    if (codeInput) { codeInput.value = ''; }
    const errEl = document.getElementById('signUpOtpError');
    if (errEl) errEl.style.display = 'none';

    document.getElementById('signUpStep1').style.display = 'none';
    document.getElementById('signUpStep2').style.display = 'block';
    setTimeout(() => document.getElementById('signUpOtpCode')?.focus(), 100);
    if (data.otp) {
      showToast(`🔑 Verification Code: ${data.otp}`);
    } else {
      showToast(`✉️ Verification code sent to ${email}`);
    }
  } catch (err) {
    showFieldError('signUpEmailError', 'Server error. Please try again.');
    if (btn) btn.querySelector('span').textContent = 'Continue';
  }
}


// Step 2: Verify OTP then register account
async function verifySignUpOtp() {
  const otp = document.getElementById('signUpOtpCode')?.value.trim() || '';
  const errEl = document.getElementById('signUpOtpError');
  const btnText = document.getElementById('verifySignUpOtpBtnText');

  if (!otp || otp.length !== 6) {
    if (errEl) { errEl.textContent = 'Please enter the complete 6-digit code'; errEl.style.display = 'block'; }
    return;
  }

  if (btnText) btnText.textContent = 'Verifying...';

  try {
    // First verify OTP
    const otpRes = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signUpPendingEmail, otp })
    });
    const otpData = await otpRes.json();

    if (!otpRes.ok) {
      if (errEl) { errEl.textContent = otpData.error || 'Invalid code. Try again.'; errEl.style.display = 'block'; }
      if (btnText) btnText.textContent = 'Verify & Create Account';
      return;
    }

    // OTP verified → now register with password
    const regRes = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signUpPendingEmail, password: signUpPendingPassword, name: signUpPendingName })
    });
    const regData = await regRes.json();

    if (!regRes.ok) {
      if (errEl) { errEl.textContent = regData.error || 'Registration failed'; errEl.style.display = 'block'; }
      if (btnText) btnText.textContent = 'Verify & Create Account';
      return;
    }

    showToast(`🎉 Account created! Welcome, ${regData.user.name}!`);
    saveGoogleUser(regData.user);
  } catch (err) {
    if (errEl) { errEl.textContent = 'Server error: ' + err.message; errEl.style.display = 'block'; }
    if (btnText) btnText.textContent = 'Verify & Create Account';
  }
}

// Resend OTP for Sign Up
async function resendSignUpOtp() {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signUpPendingEmail, name: signUpPendingName })
    });
    const data = await res.json();
    if (data.otp) {
      showToast(`🔑 New Code: ${data.otp}`);
    } else {
      showToast(`✉️ New code sent to ${signUpPendingEmail}`);
    }
  } catch (err) {
    showToast('❌ Failed to resend code');
  }
}

// Back button in Sign Up OTP step
function backToSignUpStep1() {
  document.getElementById('signUpStep2').style.display = 'none';
  document.getElementById('signUpStep1').style.display = 'block';
  const btn = document.getElementById('sendSignUpOtpBtn');
  if (btn) btn.querySelector('span').textContent = 'Continue';
}

// Keep old function name for compatibility (now unused but safe)
async function handleFullPageSignUp(e) {
  if (e) e.preventDefault();
  handleSignUpStep1(e);
}

let adminUsersCache = [];

function switchAppPage(viewName, pushToHistory = true) {
  const fullAuthPage = document.getElementById('fullAuthPage');
  const appDashboard = document.getElementById('appDashboard');
  const superAdminDashboard = document.getElementById('superAdminDashboard');

  if (fullAuthPage) fullAuthPage.classList.add('hidden');
  if (appDashboard) appDashboard.classList.add('hidden');
  if (superAdminDashboard) superAdminDashboard.classList.add('hidden');

  if (viewName === 'auth' || viewName === 'landing') {
    if (fullAuthPage) fullAuthPage.classList.remove('hidden');
    viewName = 'auth';
  } else if (viewName === 'dashboard' && appDashboard) {
    appDashboard.classList.remove('hidden');
    loadExpenses();
  } else if ((viewName === 'superadmin' || viewName === 'admin') && superAdminDashboard) {
    superAdminDashboard.classList.remove('hidden');
    loadSuperAdminData();
    loadExpenses();
  } else {
    if (fullAuthPage) fullAuthPage.classList.remove('hidden');
    viewName = 'auth';
  }
  window.scrollTo(0, 0);

  if (pushToHistory && window.history && window.history.pushState) {
    try {
      window.history.pushState({ page: viewName }, '', '#' + viewName);
    } catch (e) {}
  }
}

// Handle Browser Back and Forward buttons smoothly
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.page) {
    switchAppPage(e.state.page, false);
  } else if (state.currentGoogleUser) {
    const u = state.currentGoogleUser;
    const isSuperAdmin = (u && (u.role === 'super_admin' || (u.email && u.email.toLowerCase().trim() === 'subodhram3350@gmail.com'))) || window.location.hash === '#superadmin';
    if (isSuperAdmin) {
      switchAppPage('superadmin', false);
    } else {
      switchAppPage('dashboard', false);
    }
  } else {
    switchAppPage('auth', false);
  }
});

// ==================== SUPER ADMIN PORTAL LOGIC ====================
async function loadSuperAdminData() {
  try {
    const monthSelect = document.getElementById('adminMonthFilter');
    const selectedMonth = monthSelect ? monthSelect.value : 'all';

    const res = await fetch(`${API_BASE_URL}/admin/users?month=${selectedMonth}`);
    if (!res.ok) throw new Error('Failed to fetch admin users');
    const data = await res.json();

    if (data.success) {
      adminUsersCache = data.users || [];

      const totalUsersEl = document.getElementById('adminTotalUsersCount');
      const totalAmountEl = document.getElementById('adminTotalSystemAmount');
      const amountSubtextEl = document.getElementById('adminSystemAmountSubtext');
      const badgeEl = document.getElementById('adminUserBadge');

      if (totalUsersEl) totalUsersEl.textContent = data.totalSystemUsers || adminUsersCache.length;
      if (totalAmountEl) totalAmountEl.textContent = `₹${(data.totalSystemAmount || 0).toLocaleString('en-IN')}`;
      if (amountSubtextEl) {
        amountSubtextEl.innerHTML = `⏳ Pending: <strong>₹${(data.totalSystemPendingAmount || 0).toLocaleString('en-IN')}</strong> | ✅ Paid: <strong>₹${(data.totalSystemPaidAmount || 0).toLocaleString('en-IN')}</strong>`;
      }

      if (badgeEl) badgeEl.textContent = `${adminUsersCache.length} Users`;

      renderAdminUsersTable(adminUsersCache);
    }
  } catch (err) {
    console.error('Super Admin Data load error:', err);
  }
}

async function handleSendAdminInvite(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('inviteAdminEmailInput');
  const btn = document.getElementById('sendInviteBtn');
  const email = input?.value.trim();

  if (!email || !email.includes('@')) {
    alert('Please enter a valid Gmail address');
    return;
  }

  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Invite...';

  try {
    const res = await fetch(`${API_BASE_URL}/admin/invite-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alert(`👑 Super Admin Invitation Email successfully sent to ${email}!\n\nApproval Link: ${data.approvalLink}`);
      if (input) input.value = '';
      loadSuperAdminData();
    } else {
      alert(data.error || 'Failed to send Super Admin invitation.');
    }
  } catch (err) {
    alert('Network error sending invitation: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Admin Invite';
  }
}


function renderAdminUsersTable(users) {
  const tbody = document.getElementById('adminUsersTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 32px; color: #64748b;">
          <i class="fa-solid fa-users-slash" style="font-size: 2rem; color: #94a3b8; margin-bottom: 8px; display: block;"></i>
          No members found in the system directory yet.
        </td>
      </tr>
    `;
    return;
  }

  const selectedMonth = document.getElementById('adminMonthFilter')?.value || 'all';

  tbody.innerHTML = users.map(user => {
    const isPending = user.pendingAmount > 0;
    const isPaid = !isPending && user.paidAmount > 0;

    const statusBadge = isPending
      ? `<span style="background: #fffbeb; color: #b45309; border: 1px solid #fef3c7; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-clock"></i> Pending</span>`
      : `<span style="background: #ecfdf5; color: #047857; border: 1px solid #d1fae5; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Paid</span>`;

    const amountDisplay = isPending
      ? `₹${(user.pendingAmount || 0).toLocaleString('en-IN')}`
      : `₹0`;

    const billBtnLabel = isPaid
      ? `<i class="fa-solid fa-pen-to-square"></i> Edit Bill`
      : `<i class="fa-solid fa-upload"></i> Upload Bill`;

    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 12px 16px;">
          <img src="${user.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Member'}" alt="${user.name}" style="width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e2e8f0; object-fit: cover;" />
        </td>
        <td style="padding: 12px 16px;">
          <strong style="color: #0f172a; font-size: 0.9rem; display: block;">${user.name || 'Member'}</strong>
          <span style="color: #64748b; font-size: 0.8rem;">${user.email || 'N/A'}</span>
        </td>
        <td style="padding: 12px 16px; font-weight: 800; color: #0f172a; font-size: 0.95rem;" class="col-numeric">
          ${amountDisplay}
        </td>
        <td style="padding: 12px 16px;">
          ${statusBadge}
        </td>
        <td style="padding: 12px 16px;" class="col-actions">
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="btn btn-sm" onclick="openSettleModal('${user.id}')" title="Upload or Edit Bill" style="padding: 5px 10px; font-size: 0.78rem; font-weight: 700; background: #0f172a; color: #ffffff; border: none; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              ${billBtnLabel}
            </button>
            <button type="button" class="btn btn-sm" onclick="openEditMemberModal('${user.id}')" title="View Member & Uploaded Bill" style="padding: 5px 10px; font-size: 0.78rem; font-weight: 700; background: #ffffff; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-eye"></i> View
            </button>
            <button type="button" class="btn btn-sm" onclick="handleDeleteSettlementOrUser('${user.id}')" title="Delete Settlement or User" style="padding: 5px 10px; font-size: 0.78rem; font-weight: 700; background: #ffffff; color: #dc2626; border: 1px solid #fca5a5; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-trash-can"></i> Del
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

let currentActiveBillUrl = '';

function openEditMemberModal(userId) {
  const user = adminUsersCache.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editMemberAdminUserId').value = userId;
  const nameDisplay = document.getElementById('editMemberNameDisplay');
  const emailDisplay = document.getElementById('editMemberEmailDisplay');
  const avatarPreview = document.getElementById('editMemberAvatarPreview');

  if (nameDisplay) nameDisplay.textContent = user.name || 'Member';
  if (emailDisplay) emailDisplay.textContent = user.email || '';
  if (avatarPreview) avatarPreview.src = user.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(user.name || 'Member');

  const statusDisplay = document.getElementById('editMemberBillStatusDisplay');
  const billImg = document.getElementById('editMemberBillImage');

  const userExpenses = (state.expenses || []).filter(e => e.userId === userId);
  const paidExpenseWithBill = userExpenses.find(e => e.paymentBillUrl);
  const userReceiptExp = userExpenses.find(e => e.receipts && e.receipts.length > 0);

  const billUrl = user.paymentBillUrl || (paidExpenseWithBill ? paidExpenseWithBill.paymentBillUrl : '') || (userReceiptExp ? userReceiptExp.receipts[0] : '');
  currentActiveBillUrl = billUrl;

  if (billUrl) {
    if (statusDisplay) {
      statusDisplay.innerHTML = `<a href="${billUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: underline; font-size: 0.85rem;"><i class="fa-solid fa-up-right-from-square"></i> Open Full Resolution Image</a>`;
    }
    if (billImg) {
      billImg.src = billUrl;
      billImg.style.display = 'block';
    }
  } else {
    if (statusDisplay) {
      statusDisplay.innerHTML = `<span style="color: #94a3b8; font-size: 0.88rem;">No bill photo uploaded yet for this member.</span>`;
    }
    if (billImg) {
      billImg.style.display = 'none';
      billImg.src = '';
    }
  }

  const modal = document.getElementById('editMemberAdminModal');
  if (modal) openModal(modal);
}

function openUploadedBillFullSize() {
  if (currentActiveBillUrl) {
    window.open(currentActiveBillUrl, '_blank');
  }
}

async function handleAdminReuploadBillSelect(e) {
  const file = e.target.files ? e.target.files[0] : null;
  const userId = document.getElementById('editMemberAdminUserId')?.value;
  const selectedMonth = document.getElementById('adminMonthFilter')?.value || 'all';

  if (!file || !userId) return;

  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('month', selectedMonth);
  formData.append('action', 'update');
  formData.append('paymentProof', file);

  try {
    const res = await fetch(`${API_BASE_URL}/admin/update-settlement-bill`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✅ Payment bill proof re-uploaded successfully!`);
      closeModal(document.getElementById('editMemberAdminModal'));
      loadSuperAdminData();
    } else {
      alert(data.error || 'Failed to update bill');
    }
  } catch (err) {
    alert('Error re-uploading bill: ' + err.message);
  }
}

async function handleAdminDeleteBill() {
  const userId = document.getElementById('editMemberAdminUserId')?.value;
  const selectedMonth = document.getElementById('adminMonthFilter')?.value || 'all';
  if (!userId) return;

  showConfirmModal({
    title: 'Delete Payment Bill Proof?',
    message: 'Are you sure you want to delete this payment bill receipt proof and reset payment status to Pending?',
    iconClass: 'fa-trash-can',
    btnText: 'Delete Bill Proof',
    onConfirm: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/admin/update-settlement-bill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, month: selectedMonth, action: 'delete' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          closeModal(document.getElementById('editMemberAdminModal'));
          if (typeof showCustomToast === 'function') showCustomToast('Uploaded bill deleted and status reset to Pending');
          else alert('Uploaded bill deleted and status reset to Pending');
          loadSuperAdminData();
        } else {
          alert(data.error || 'Failed to delete bill');
        }
      } catch (err) {
        alert('Error deleting bill: ' + err.message);
      }
    }
  });
}

async function deleteMemberFromEditModal() {
  const userId = document.getElementById('editMemberAdminUserId')?.value;
  const user = adminUsersCache.find(u => u.id === userId);
  if (!userId) return;

  showConfirmModal({
    title: 'Delete Member Account?',
    message: `Are you sure you want to permanently delete member ${user ? user.name : 'this member'}? This action cannot be undone.`,
    iconClass: 'fa-user-slash',
    btnText: 'Delete Member',
    onConfirm: async () => {
      closeModal(document.getElementById('editMemberAdminModal'));
      try {
        const res = await fetch(`${API_BASE_URL}/admin/delete-settlement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, action: 'delete_user' })
        });
        const data = await res.json();
        if (data.success) {
          if (typeof showCustomToast === 'function') showCustomToast(`Member removed successfully`);
          else alert(`Member removed successfully.`);
          loadSuperAdminData();
        } else {
          alert(data.error || 'Failed to delete member');
        }
      } catch (err) {
        alert('Error deleting member: ' + err.message);
      }
    }
  });
}

function inspectMemberLogsFromEdit() {
  const userId = document.getElementById('editMemberAdminUserId')?.value;
  closeModal(document.getElementById('editMemberAdminModal'));
  if (userId) inspectUserExpenses(userId);
}

async function handleEditMemberSubmit(e) {
  if (e) e.preventDefault();
  const userId = document.getElementById('editMemberAdminUserId')?.value;
  const name = document.getElementById('editMemberAdminNameInput')?.value.trim();
  const email = document.getElementById('editMemberAdminEmailInput')?.value.trim();
  const btn = document.getElementById('saveEditMemberBtn');

  if (!userId || !name || !email) return;

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/admin/edit-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name, email })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alert(`✅ Member details updated for "${data.user.name}"!`);
      closeModal(document.getElementById('editMemberAdminModal'));
      loadSuperAdminData();
    } else {
      alert(data.error || 'Failed to update member');
    }
  } catch (err) {
    alert('Error updating member: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openAddMemberModal() {
  const modal = document.getElementById('addMemberModal');
  const form = document.getElementById('addMemberForm');
  if (form) form.reset();
  if (modal) openModal(modal);
}

async function handleAddMemberSubmit(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('newMemberNameInput')?.value.trim();
  const email = document.getElementById('newMemberEmailInput')?.value.trim();
  const btn = document.getElementById('saveMemberBtn');

  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address');
    return;
  }

  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/admin/add-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alert(`✅ New member "${data.user.name}" added successfully!`);
      closeModal(document.getElementById('addMemberModal'));
      loadSuperAdminData();
    } else {
      alert(data.error || 'Failed to add member');
    }
  } catch (err) {
    alert('Error adding member: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openSettleModal(userId) {
  const user = adminUsersCache.find(u => u.id === userId);
  if (!user) return;

  const selectedMonth = document.getElementById('adminMonthFilter')?.value || 'all';

  document.getElementById('settleUserId').value = userId;
  document.getElementById('settleMonth').value = selectedMonth;
  document.getElementById('settleMemberName').textContent = `${user.name} (${user.email})`;

  const amountVal = user.pendingAmount > 0 ? user.pendingAmount : user.paidAmount;
  document.getElementById('settleMemberAmount').textContent = `₹${(amountVal || 0).toLocaleString('en-IN')}`;

  const proofContainer = document.getElementById('settleCurrentProofContainer');
  const submitBtn = document.getElementById('submitSettleBtn');

  const userExpenses = (state.expenses || []).filter(e => e.userId === userId);
  const paidExpenseWithBill = userExpenses.find(e => e.paymentBillUrl);

  const billUrl = user.paymentBillUrl || (paidExpenseWithBill ? paidExpenseWithBill.paymentBillUrl : '');

  if (billUrl) {
    if (proofContainer) {
      proofContainer.innerHTML = `
        <div style="margin-bottom: 4px;"><span style="color: #059669; font-weight: 700;">✅ Paid & Settled</span></div>
        <div><a href="${billUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: underline;"><i class="fa-solid fa-file-image"></i> View Current Uploaded Bill Proof</a></div>
      `;
    }
    if (submitBtn) {
      submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Update Settlement & Email Receipt`;
    }
  } else {
    if (proofContainer) {
      proofContainer.innerHTML = `<span style="color: #d97706; font-weight: 600;">⏳ Payment Pending (Unsettled)</span>`;
    }
    if (submitBtn) {
      submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Settle & Email Receipt`;
    }
  }

  const modal = document.getElementById('settlePaymentModal');
  if (modal) openModal(modal);
}

async function handleSettlePaymentSubmit(e) {
  if (e) e.preventDefault();
  const userId = document.getElementById('settleUserId')?.value;
  const month = document.getElementById('settleMonth')?.value;
  const notes = document.getElementById('settleNotesInput')?.value;
  const proofInput = document.getElementById('settlePaymentProofInput');
  const btn = document.getElementById('submitSettleBtn');

  if (!userId) return;

  const formData = new FormData();
  formData.append('userId', userId);
  formData.append('month', month);
  formData.append('notes', notes || '');

  if (proofInput && proofInput.files && proofInput.files[0]) {
    formData.append('paymentProof', proofInput.files[0]);
  }

  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Settling & Sending Email...';

  try {
    const res = await fetch(`${API_BASE_URL}/admin/settle-payment`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alert(`✅ ${data.message}\n\nReimbursement receipt email sent to member!`);
      closeModal(document.getElementById('settlePaymentModal'));
      loadSuperAdminData();
    } else {
      alert(data.error || 'Failed to settle payment.');
    }
  } catch (err) {
    alert('Error settling payment: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Settle & Email Receipt';
  }
}

let activeManageUserId = null;

function handleDeleteSettlementOrUser(userId) {
  const user = adminUsersCache.find(u => u.id === userId);
  if (!user) return;

  activeManageUserId = userId;
  const nameEl = document.getElementById('manageMemberNameDisplay');
  const emailEl = document.getElementById('manageMemberEmailDisplay');
  if (nameEl) nameEl.textContent = user.name || 'Member';
  if (emailEl) emailEl.textContent = user.email || '';

  const modal = document.getElementById('manageMemberModal');
  if (modal) openModal(modal);
}

async function executeMemberAction(action) {
  if (!activeManageUserId) return;
  const user = adminUsersCache.find(u => u.id === activeManageUserId);
  const selectedMonth = document.getElementById('adminMonthFilter')?.value || 'all';

  closeModal(document.getElementById('manageMemberModal'));

  if (action === 'reset') {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/delete-settlement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeManageUserId, month: selectedMonth, action: 'reset' })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ Status reset back to Pending for ${user ? user.name : 'member'}`);
        loadSuperAdminData();
      }
    } catch (err) {
      alert('Error resetting status: ' + err.message);
    }
  } else if (action === 'delete') {
    showConfirmModal({
      title: 'Delete Member Account?',
      message: `Are you sure you want to permanently delete member ${user ? user.name : 'this member'}? This action cannot be undone.`,
      iconClass: 'fa-user-slash',
      btnText: 'Delete Member',
      onConfirm: async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/admin/delete-settlement`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: activeManageUserId, action: 'delete_user' })
          });
          const data = await res.json();
          if (data.success) {
            if (typeof showCustomToast === 'function') showCustomToast(`Member removed successfully`);
            else alert(`Member removed successfully.`);
            loadSuperAdminData();
          } else {
            alert(data.error || 'Failed to delete member');
          }
        } catch (err) {
          alert('Error deleting member: ' + err.message);
        }
      }
    });
  }
}

function exportMembersToExcel() {
  if (!adminUsersCache || adminUsersCache.length === 0) {
    alert('No member records available to export.');
    return;
  }

  const selectedMonth = document.getElementById('adminMonthFilter')?.value || 'All_Months';

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Member ID,Name,Email,Pending Amount (INR),Paid Amount (INR),Total Lifetime Amount (INR),Status,Month\n";

  adminUsersCache.forEach(u => {
    const status = u.pendingAmount > 0 ? "Pending" : "Paid";
    const row = [
      `"${u.id}"`,
      `"${u.name || ''}"`,
      `"${u.email || ''}"`,
      u.pendingAmount || 0,
      u.paidAmount || 0,
      u.lifetimeAmount || 0,
      `"${status}"`,
      `"${selectedMonth}"`
    ].join(",");
    csvContent += row + "\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `FreeG_Wifi_Member_Details_${selectedMonth}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function filterAdminUserTable() {
  const query = (document.getElementById('adminSearchUsers')?.value || '').toLowerCase().trim();
  if (!query) {
    renderAdminUsersTable(adminUsersCache);
    return;
  }
  const filtered = adminUsersCache.filter(u => 
    (u.name && u.name.toLowerCase().includes(query)) ||
    (u.email && u.email.toLowerCase().includes(query))
  );
  renderAdminUsersTable(filtered);
}

function inspectUserExpenses(userId) {
  state.sharedMode = true;
  fetchUserExpenses(userId);
  switchAppPage('dashboard');
  if (typeof showCustomToast === 'function') {
    showCustomToast(`Inspecting logs for user: ${userId}`);
  }
}


function openAuthScreen(mode = 'signin') {
  switchAppPage('auth');
  toggleAuthPageView(mode);
}

function openRealGoogleAuthPopup(defaultEmail = '') {
  const modal = document.getElementById('googleAccountChooserModal');
  if (modal) {
    const savedContainer = document.getElementById('savedAccountsContainer');
    if (savedContainer) {
      const savedUser = getStoredGoogleUser();
      if (savedUser && savedUser.email && savedUser.email !== 'user@example.com') {
        const safeName = (savedUser.name || savedUser.email.split('@')[0]).replace(/'/g, "\\'");
        const safeEmail = savedUser.email.replace(/'/g, "\\'");
        savedContainer.innerHTML = `
          <div class="google-account-option" onclick="selectGoogleAccount('${safeName}', '${safeEmail}')" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: all 0.2s ease;">
            <img src="${savedUser.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(savedUser.name || 'User')}" alt="${savedUser.name}" class="google-account-avatar" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid #000000;" />
            <div class="google-account-details" style="flex: 1;">
              <h4 style="font-size: 0.98rem; font-weight: 700; color: #0f172a; margin: 0;">${savedUser.name} <span class="badge-default" style="background: linear-gradient(135deg, #ffc3d0 0%, #e3d5fa 50%, #cbddf9 100%); color: #000000; font-size: 0.75rem; padding: 2px 8px; border-radius: 6px; margin-left: 6px;">Active</span></h4>
              <p style="font-size: 0.82rem; color: #475569; margin: 3px 0 0 0;">${savedUser.email}</p>
            </div>
            <i class="fa-solid fa-angle-right account-arrow" style="color: #000000;"></i>
          </div>
          <div class="google-chooser-divider" style="text-align: center; position: relative; margin: 16px 0; border-bottom: 1px solid #e2e8f0;">
            <span style="background: #ffffff; color: #64748b; padding: 0 12px; font-size: 0.78rem; font-weight: 700; position: relative; top: 8px;">OR USE ANOTHER ACCOUNT</span>
          </div>
        `;
      } else {
        savedContainer.innerHTML = '';
      }
    }

    const emailInput = document.getElementById('customChooserEmail');
    if (emailInput && defaultEmail) {
      emailInput.value = defaultEmail;
    }
    openModal(modal);
  } else {
    if (defaultEmail) {
      selectGoogleAccount(defaultEmail.split('@')[0], defaultEmail);
    } else {
      openAuthScreen('signin');
    }
  }
}

function selectGoogleAccount(name, email) {
  const cleanName = name || email.split('@')[0].replace(/[\._]/g, ' ');
  const capitalizedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
  const id = `google_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const picture = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(capitalizedName)}`;

  const user = { id, name: capitalizedName, email, picture };
  
  const modal = document.getElementById('googleAccountChooserModal');
  if (modal) closeModal(modal);

  showToast(`🎉 Signed in as ${email}`);
  saveGoogleUser(user);
}

function handleCustomGoogleAccountSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('customChooserEmail');
  if (!emailInput) return;

  const email = emailInput.value.trim();
  if (!email || !email.includes('@')) {
    alert('Please enter a valid Google email address');
    return;
  }
  selectGoogleAccount(email.split('@')[0], email);
}
