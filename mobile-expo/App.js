import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, SafeAreaView, ScrollView,
  TouchableOpacity, TextInput, ActivityIndicator, Alert,
  Modal, RefreshControl, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// ==================== CONFIG ====================
const RENDER_URL     = 'https://travelexpense-52gp.onrender.com/api';
const LOCAL_WIFI_URL = 'http://192.168.1.8:3000/api';
const EMULATOR_URL   = 'http://10.0.2.2:3000/api';
const LOCALHOST_URL  = 'http://localhost:3000/api';

function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

// ==================== SCREENS ====================
// 'auth'      → Login / Signup
// 'dashboard' → Expense list

export default function App() {
  const [screen, setScreen]   = useState('auth');   // 'auth' | 'dashboard'
  const [baseUrl, setBaseUrl] = useState(RENDER_URL);
  const [currentUser, setCurrentUser] = useState(null); // { id, name, email, picture }

  // Auth sub-view: 'signin' | 'signup_step1' | 'signup_step2' | 'otp_step1' | 'otp_step2' | 'otp_step3'
  const [authView, setAuthView] = useState('signin');

  // ------ SIGN IN state ------
  const [siEmail, setSiEmail]     = useState('');
  const [siPassword, setSiPassword] = useState('');
  const [siLoading, setSiLoading]  = useState(false);
  const [siError, setSiError]      = useState('');

  // ------ SIGN UP state ------
  const [suName, setSuName]       = useState('');
  const [suEmail, setSuEmail]     = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suLoading, setSuLoading]  = useState(false);
  const [suError, setSuError]      = useState('');
  // OTP step for signup
  const [suOtpCode, setSuOtpCode]  = useState('');
  const [suOtpError, setSuOtpError] = useState('');
  const [suOtpLoading, setSuOtpLoading] = useState(false);
  // pending data while waiting for otp
  const signUpPending = useRef({ name: '', email: '', password: '' });

  // ------ GOOGLE OTP state ------
  const [gOtpEmail, setGOtpEmail]   = useState('');
  const [gOtpCode, setGOtpCode]     = useState('');
  const [gOtpError, setGOtpError]   = useState('');
  const [gOtpLoading, setGOtpLoading] = useState(false);
  // setup step 3
  const [setupName, setSetupName]    = useState('');
  const [setupPwd, setSetupPwd]      = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupError, setSetupError]   = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const gOtpPendingEmail = useRef('');

  // ------ DASHBOARD state ------
  const [expenses, setExpenses]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [customUrlInput, setCustomUrlInput]   = useState('');
  const [formDate, setFormDate] = useState(getTodayDate());
  const [formLocation, setFormLocation] = useState('');
  const [formEntries, setFormEntries] = useState([
    { type: 'Metro', amount: '' },
    { type: 'Local Train', amount: '' },
    { type: 'Auto/Rapido', amount: '' },
    { type: 'Cab/Others', amount: '' },
  ]);
  const [savingExpense, setSavingExpense]     = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  useEffect(() => {
    let interval;
    if (screen === 'dashboard' && currentUser && currentUser.id) {
      interval = setInterval(() => {
        fetchExpensesForSilent(currentUser.id);
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [screen, currentUser, baseUrl]);

  const fetchExpensesForSilent = async (uid) => {
    if (!uid) return;
    try {
      const res = await fetch(`${baseUrl}/expenses`, { headers: { 'user-id': uid } });
      if (res.ok) {
        const d = await res.json();
        setExpenses(d.expenses || []);
      }
    } catch (e) {
      // silent background refresh note
    }
  };

  function goToDashboard(user) {
    setCurrentUser(user);
    setScreen('dashboard');
    // fetch expenses for this user
    fetchExpensesFor(user.id);
  }

  function signOut() {
    setCurrentUser(null);
    setScreen('auth');
    setAuthView('signin');
    setSiEmail(''); setSiPassword(''); setSiError('');
  }

  // ==================== AUTH LOGIC ====================

  // ---- SIGN IN ----
  async function handleSignIn() {
    setSiError('');
    if (!siEmail.includes('@')) { setSiError('Please enter a valid email address'); return; }
    if (!siPassword)            { setSiError('Please enter your password'); return; }
    setSiLoading(true);
    try {
      const res  = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: siEmail.trim(), password: siPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setSiError(data.error || 'Sign in failed. Check your credentials.'); setSiLoading(false); return; }
      goToDashboard(data.user);
    } catch (e) {
      setSiError('Cannot connect to server. Make sure the backend is running.');
    } finally { setSiLoading(false); }
  }

  // ---- SIGN UP Step 1: validate + check email + send OTP ----
  async function handleSignUpStep1() {
    setSuError('');
    if (!suEmail.includes('@'))    { setSuError('Please enter a valid email address'); return; }
    if (suPassword.length < 6)     { setSuError('Password must be at least 6 characters'); return; }
    setSuLoading(true);
    try {
      // Check if already exists
      const checkRes  = await fetch(`${baseUrl}/auth/check-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suEmail.trim() }),
      });
      const checkData = await checkRes.json();
      if (checkData.exists) {
        setSuError('This email is already registered. Please sign in.');
        setSuLoading(false);
        return;
      }
      // Send OTP
      const res  = await fetch(`${baseUrl}/auth/send-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suEmail.trim(), name: suName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setSuError(data.error || 'Failed to send verification code'); setSuLoading(false); return; }
      signUpPending.current = { name: suName.trim(), email: suEmail.trim(), password: suPassword };
      setSuOtpCode('');
      setSuOtpError('');
      setAuthView('signup_step2');
    } catch (e) {
      setSuError('Server error. Make sure backend is running.');
    } finally { setSuLoading(false); }
  }

  // ---- SIGN UP Step 2: verify OTP + register ----
  async function handleSignUpStep2() {
    setSuOtpError('');
    if (suOtpCode.length !== 6) { setSuOtpError('Please enter the complete 6-digit code'); return; }
    setSuOtpLoading(true);
    try {
      const { name, email, password } = signUpPending.current;
      // verify OTP
      const otpRes  = await fetch(`${baseUrl}/auth/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: suOtpCode }),
      });
      const otpData = await otpRes.json();
      if (!otpRes.ok) { setSuOtpError(otpData.error || 'Invalid code. Try again.'); setSuOtpLoading(false); return; }

      // register
      const regRes  = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) { setSuOtpError(regData.error || 'Registration failed'); setSuOtpLoading(false); return; }
      Alert.alert('🎉 Account Created!', `Welcome, ${regData.user.name}!`);
      goToDashboard(regData.user);
    } catch (e) {
      setSuOtpError('Server error: ' + e.message);
    } finally { setSuOtpLoading(false); }
  }

  // ---- GOOGLE OTP Step 1: send OTP ----
  async function handleGoogleOtpSend(isResend = false) {
    setGOtpError('');
    if (!gOtpEmail.includes('@')) { setGOtpError('Please enter a valid email address'); return; }
    setGOtpLoading(true);
    try {
      const res  = await fetch(`${baseUrl}/auth/send-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: gOtpEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setGOtpError(data.error || 'Failed to send code'); setGOtpLoading(false); return; }
      gOtpPendingEmail.current = gOtpEmail.trim();
      setGOtpCode('');
      setGOtpError('');
      setAuthView('otp_step2');
      if (isResend) Alert.alert('✉️ Code Resent', `New code sent to ${gOtpEmail.trim()}`);
    } catch (e) {
      setGOtpError('Server error. Make sure backend is running.');
    } finally { setGOtpLoading(false); }
  }

  // ---- GOOGLE OTP Step 2: verify OTP ----
  async function handleGoogleOtpVerify() {
    setGOtpError('');
    if (gOtpCode.length !== 6) { setGOtpError('Please enter the complete 6-digit code'); return; }
    setGOtpLoading(true);
    try {
      const res  = await fetch(`${baseUrl}/auth/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: gOtpPendingEmail.current, otp: gOtpCode }),
      });
      const data = await res.json();
      if (!res.ok) { setGOtpError(data.error || 'Invalid code. Try again.'); setGOtpLoading(false); return; }

      if (data.hasPassword) {
        // Existing user → login directly
        Alert.alert('👋 Welcome back!', `Signed in as ${data.user.name}`);
        goToDashboard(data.user);
      } else {
        // New user → setup step
        setSetupName(data.user.name || '');
        setSetupPwd(''); setSetupConfirm(''); setSetupError('');
        setAuthView('otp_step3');
      }
    } catch (e) {
      setGOtpError('Server error: ' + e.message);
    } finally { setGOtpLoading(false); }
  }

  // ---- GOOGLE OTP Step 3: setup account ----
  async function handleGoogleOtpSetup() {
    setSetupError('');
    if (!setupName.trim())     { setSetupError('Please enter your display name'); return; }
    if (setupPwd.length < 6)   { setSetupError('Password must be at least 6 characters'); return; }
    if (setupPwd !== setupConfirm) { setSetupError('Passwords do not match'); return; }
    setSetupLoading(true);
    try {
      const res  = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: gOtpPendingEmail.current, password: setupPwd, name: setupName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setSetupError(data.error || 'Setup failed'); setSetupLoading(false); return; }
      Alert.alert('🎉 Account Ready!', `Welcome, ${data.user.name}!`);
      goToDashboard(data.user);
    } catch (e) {
      setSetupError('Server error: ' + e.message);
    } finally { setSetupLoading(false); }
  }

  // ==================== EXPENSE API ====================
  const fetchExpensesFor = async (uid) => {
    if (!uid) return;
    setLoading(true); setErrorMessage(null);
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 12000);
      const res  = await fetch(`${baseUrl}/expenses`, { headers: { 'user-id': uid }, signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) { const d = await res.json(); setExpenses(d.expenses || []); }
      else throw new Error(`Server: ${res.status}`);
    } catch (e) {
      setErrorMessage(e.name === 'AbortError'
        ? `Timeout. Switch to Local or Emulator server in Settings.`
        : `Cannot connect to server.`);
    } finally { setLoading(false); setRefreshing(false); }
  };

  const handleSaveExpense = async () => {
    if (!formLocation.trim()) { Alert.alert('Required', 'Please enter a destination'); return; }
    setSavingExpense(true);
    try {
      const res = await fetch(`${baseUrl}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-id': currentUser.id },
        body: JSON.stringify({
          date: formDate, location: formLocation.trim(),
          entries: formEntries.map(e => ({ type: e.type, amount: parseFloat(e.amount) || 0 })),
        }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved!', 'Travel expense logged.');
        setAddModalVisible(false);
        setFormLocation(''); setFormDate(getTodayDate());
        setFormEntries([
          { type: 'Metro', amount: '' }, { type: 'Local Train', amount: '' },
          { type: 'Auto/Rapido', amount: '' }, { type: 'Cab/Others', amount: '' },
        ]);
        fetchExpensesFor(currentUser.id);
      } else { Alert.alert('Error', 'Failed to save expense'); }
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setSavingExpense(false); }
  };

  const handleDeleteExpense = async (id) => {
    Alert.alert('Delete', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await fetch(`${baseUrl}/expenses/${id}`, {
            method: 'DELETE', headers: { 'user-id': currentUser.id },
          });
          setSelectedExpense(null);
          fetchExpensesFor(currentUser.id);
        } catch (e) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  const handlePickAndUploadReceipt = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingReceipt(true);
    try {
      const asset = result.assets[0];
      const fd = new FormData();
      fd.append('receipt', { uri: asset.uri, type: 'image/jpeg', name: 'receipt.jpg' });
      const res = await fetch(`${baseUrl}/expenses/${selectedExpense.id}/receipts`, {
        method: 'POST', headers: { 'user-id': currentUser.id }, body: fd,
      });
      if (res.ok) {
        Alert.alert('✅', 'Receipt uploaded!');
        const updated = await fetch(`${baseUrl}/expenses`, { headers: { 'user-id': currentUser.id } }).then(r => r.json());
        if (updated.expenses) {
          setExpenses(updated.expenses);
          const cur = updated.expenses.find(e => e.id === selectedExpense.id);
          if (cur) setSelectedExpense(cur);
        }
      } else Alert.alert('Upload Failed');
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setUploadingReceipt(false); }
  };

  const grandTotal = expenses.reduce((a, c) => a + (c.total || 0), 0);

  // ==================== AUTH SCREEN ====================
  if (screen === 'auth') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">

            {/* Logo */}
            <View style={styles.authLogoRow}>
              <Text style={styles.authLogoText}>✈️ TravelExpense</Text>
              <Text style={styles.authLogoSub}>Monthly Travel Log</Text>
            </View>

            {/* ---- SIGN IN ---- */}
            {authView === 'signin' && (
              <View style={styles.authCard}>
                <Text style={styles.authTitle}>Welcome back</Text>
                <Text style={styles.authSubtitle}>
                  Don't have an account?{' '}
                  <Text style={styles.authLink} onPress={() => { setAuthView('signup_step1'); setSuError(''); }}>Sign up</Text>
                </Text>

                {/* Google OTP button */}
                <TouchableOpacity style={styles.googleBtn} onPress={() => { setGOtpEmail(''); setGOtpError(''); setAuthView('otp_step1'); }}>
                  <Text style={styles.googleBtnIcon}>G</Text>
                  <Text style={styles.googleBtnText}>Sign in with Google</Text>
                </TouchableOpacity>

                <View style={styles.dividerRow}><View style={styles.dividerLine}/><Text style={styles.dividerText}>or sign in with password</Text><View style={styles.dividerLine}/></View>

                {siError ? <Text style={styles.errorMsg}>{siError}</Text> : null}
                <TextInput style={styles.input} placeholder="Email address" value={siEmail} onChangeText={setSiEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
                <TextInput style={styles.input} placeholder="Password" value={siPassword} onChangeText={setSiPassword} secureTextEntry />
                <TouchableOpacity style={[styles.primaryBtn, siLoading && { opacity: 0.7 }]} onPress={handleSignIn} disabled={siLoading}>
                  {siLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
                </TouchableOpacity>

                <Text style={styles.serverHint}>Server: {baseUrl.includes('onrender') ? '🌐 Render Live' : '💻 Local'}</Text>
                <TouchableOpacity onPress={() => setSettingsVisible(true)}><Text style={[styles.authLink, { textAlign: 'center', marginTop: 4 }]}>⚙️ Change Server</Text></TouchableOpacity>
              </View>
            )}

            {/* ---- SIGN UP Step 1 ---- */}
            {authView === 'signup_step1' && (
              <View style={styles.authCard}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setAuthView('signin')}>
                  <Text style={styles.backBtnText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.authTitle}>Create account</Text>
                <Text style={styles.authSubtitle}>
                  Already have one?{' '}
                  <Text style={styles.authLink} onPress={() => setAuthView('signin')}>Sign in</Text>
                </Text>

                {/* Google OTP button */}
                <TouchableOpacity style={styles.googleBtn} onPress={() => { setGOtpEmail(''); setGOtpError(''); setAuthView('otp_step1'); }}>
                  <Text style={styles.googleBtnIcon}>G</Text>
                  <Text style={styles.googleBtnText}>Sign up with Google</Text>
                </TouchableOpacity>

                <View style={styles.dividerRow}><View style={styles.dividerLine}/><Text style={styles.dividerText}>or create with password</Text><View style={styles.dividerLine}/></View>

                {suError ? <Text style={styles.errorMsg}>{suError}</Text> : null}
                <TextInput style={styles.input} placeholder="Your name (optional)" value={suName} onChangeText={setSuName} autoCapitalize="words" />
                <TextInput style={styles.input} placeholder="Email address" value={suEmail} onChangeText={setSuEmail} keyboardType="email-address" autoCapitalize="none" />
                <TextInput style={styles.input} placeholder="Password (min 6 chars)" value={suPassword} onChangeText={setSuPassword} secureTextEntry />
                <TouchableOpacity style={[styles.primaryBtn, suLoading && { opacity: 0.7 }]} onPress={handleSignUpStep1} disabled={suLoading}>
                  {suLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Continue →</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* ---- SIGN UP Step 2: OTP ---- */}
            {authView === 'signup_step2' && (
              <View style={styles.authCard}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setAuthView('signup_step1')}>
                  <Text style={styles.backBtnText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.authTitle}>Check your email</Text>
                <Text style={styles.authSubtitle}>We sent a 6-digit code to</Text>
                <Text style={styles.authEmailHighlight}>{signUpPending.current.email}</Text>

                {suOtpError ? <Text style={styles.errorMsg}>{suOtpError}</Text> : null}
                <TextInput
                  style={styles.otpInput} placeholder="000000" value={suOtpCode}
                  onChangeText={v => { const d = v.replace(/\D/g,''); setSuOtpCode(d); if(d.length===6) handleSignUpStep2(); }}
                  keyboardType="number-pad" maxLength={6}
                />
                <TouchableOpacity style={[styles.primaryBtn, suOtpLoading && { opacity: 0.7 }]} onPress={handleSignUpStep2} disabled={suOtpLoading}>
                  {suOtpLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Verify & Create Account</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={{ marginTop: 12 }} onPress={() => handleSignUpStep1()}>
                  <Text style={[styles.authLink, { textAlign: 'center' }]}>Resend code</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ---- GOOGLE OTP Step 1: Enter Email ---- */}
            {authView === 'otp_step1' && (
              <View style={styles.authCard}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setAuthView('signin')}>
                  <Text style={styles.backBtnText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.authTitle}>Sign in with Google</Text>
                <Text style={styles.authSubtitle}>Enter your email to receive a verification code</Text>

                {gOtpError ? <Text style={styles.errorMsg}>{gOtpError}</Text> : null}
                <TextInput style={styles.input} placeholder="Enter your email address" value={gOtpEmail} onChangeText={setGOtpEmail} keyboardType="email-address" autoCapitalize="none" />
                <TouchableOpacity style={[styles.primaryBtn, gOtpLoading && { opacity: 0.7 }]} onPress={() => handleGoogleOtpSend()} disabled={gOtpLoading}>
                  {gOtpLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Send Verification Code</Text>}
                </TouchableOpacity>
              </View>
            )}

            {/* ---- GOOGLE OTP Step 2: Enter OTP ---- */}
            {authView === 'otp_step2' && (
              <View style={styles.authCard}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setAuthView('otp_step1')}>
                  <Text style={styles.backBtnText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.authTitle}>Check your email</Text>
                <Text style={styles.authSubtitle}>We sent a 6-digit code to</Text>
                <Text style={styles.authEmailHighlight}>{gOtpPendingEmail.current}</Text>

                {gOtpError ? <Text style={styles.errorMsg}>{gOtpError}</Text> : null}
                <TextInput
                  style={styles.otpInput} placeholder="000000" value={gOtpCode}
                  onChangeText={v => { const d = v.replace(/\D/g,''); setGOtpCode(d); if(d.length===6) handleGoogleOtpVerify(); }}
                  keyboardType="number-pad" maxLength={6}
                />
                <TouchableOpacity style={[styles.primaryBtn, gOtpLoading && { opacity: 0.7 }]} onPress={handleGoogleOtpVerify} disabled={gOtpLoading}>
                  {gOtpLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Verify Code</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={{ marginTop: 12 }} onPress={() => handleGoogleOtpSend(true)}>
                  <Text style={[styles.authLink, { textAlign: 'center' }]}>Resend code</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ---- GOOGLE OTP Step 3: Setup Account ---- */}
            {authView === 'otp_step3' && (
              <View style={styles.authCard}>
                <Text style={styles.authTitle}>Set up your account</Text>
                <Text style={styles.authSubtitle}>Almost there! Set a display name and password.</Text>

                {setupError ? <Text style={styles.errorMsg}>{setupError}</Text> : null}
                <TextInput style={styles.input} placeholder="Your display name" value={setupName} onChangeText={setSetupName} autoCapitalize="words" />
                <TextInput style={styles.input} placeholder="Set a password (min 6 chars)" value={setupPwd} onChangeText={setSetupPwd} secureTextEntry />
                <TextInput style={styles.input} placeholder="Confirm your password" value={setupConfirm} onChangeText={setSetupConfirm} secureTextEntry />
                <TouchableOpacity style={[styles.primaryBtn, setupLoading && { opacity: 0.7 }]} onPress={handleGoogleOtpSetup} disabled={setupLoading}>
                  {setupLoading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Complete Setup</Text>}
                </TouchableOpacity>
              </View>
            )}

          </ScrollView>
        </KeyboardAvoidingView>

        {/* Settings Modal (server switcher) */}
        <Modal visible={settingsVisible} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>⚙️ Server Settings</Text>
                <TouchableOpacity onPress={() => setSettingsVisible(false)}><Text style={{ fontSize: 20, color: '#6E6E73' }}>✕</Text></TouchableOpacity>
              </View>
              {[{ label: '🌐 Render Live', url: RENDER_URL }, { label: '📱 Emulator (10.0.2.2)', url: EMULATOR_URL }, { label: '💻 Localhost', url: LOCALHOST_URL }].map(opt => (
                <TouchableOpacity key={opt.url} style={[styles.optionBox, baseUrl === opt.url && styles.optionSelected]} onPress={() => { setBaseUrl(opt.url); setSettingsVisible(false); }}>
                  <Text style={styles.optionTitle}>{opt.label}</Text>
                  <Text style={styles.optionSubtitle}>{opt.url}</Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.inputLabel}>Custom Wi-Fi / Tunnel URL:</Text>
              <TextInput style={styles.textInput} placeholder="http://192.168.x.x:3000/api" value={customUrlInput} onChangeText={setCustomUrlInput} autoCapitalize="none" />
              <TouchableOpacity style={styles.blackPillBtn} onPress={() => { if (customUrlInput.trim()) { setBaseUrl(customUrlInput.trim()); } setSettingsVisible(false); }}>
                <Text style={styles.blackPillBtnText}>Save & Reconnect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ==================== DASHBOARD SCREEN ====================
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* HEADER */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Travel Expense Log</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            👤 {currentUser?.name || 'User'} · {baseUrl.includes('onrender') ? 'Render Live' : 'Local'}
          </Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setSettingsVisible(true)}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => fetchExpensesFor(currentUser?.id)}>
          <Text style={{ fontSize: 20 }}>🔄</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={signOut}>
          <Text style={{ fontSize: 20 }}>🚪</Text>
        </TouchableOpacity>
      </View>

      {/* SUMMARY CARD */}
      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryLabel}>Total Expense Logged</Text>
          <Text style={styles.summaryValue}>₹{grandTotal.toLocaleString('en-IN')}</Text>
        </View>
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>{expenses.length} Trips</Text>
        </View>
      </View>

      {/* EXPENSE LIST */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={{ marginTop: 12, color: '#6E6E73' }}>Loading expenses...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.centerContainer}>
          <Text style={{ fontSize: 40 }}>📶</Text>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.blackPillBtn} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.blackPillBtnText}>⚙️ Switch Server</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: 12 }} onPress={() => fetchExpensesFor(currentUser?.id)}>
            <Text style={{ color: '#000000', fontWeight: 'bold' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : expenses.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={{ fontSize: 50 }}>🧾</Text>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginTop: 12, color: '#1C1C1E' }}>No Expenses Yet</Text>
          <Text style={{ color: '#6E6E73', marginTop: 4 }}>Tap "+ Add Travel Entry" to get started</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1, paddingHorizontal: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchExpensesFor(currentUser?.id)} />}>
          {expenses.map((expense) => (
            <TouchableOpacity key={expense.id || expense._id} style={styles.expenseCard} onPress={() => setSelectedExpense(expense)}>
              <View style={styles.cardHeader}>
                <View style={styles.iconCircle}><Text style={{ fontSize: 18 }}>🚕</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.locationTitle}>{expense.location}</Text>
                  <Text style={styles.dateText}>Date: {expense.date}</Text>
                </View>
                <Text style={styles.amountText}>₹{(expense.total || 0).toFixed(0)}</Text>
              </View>
              {expense.entries?.length > 0 && (
                <View style={styles.breakdownRow}>
                  {expense.entries.filter(e => e.amount > 0).map((entry, idx) => (
                    <View key={idx} style={styles.chip}><Text style={styles.chipText}>{entry.type}: ₹{entry.amount}</Text></View>
                  ))}
                </View>
              )}
              <View style={styles.cardFooter}>
                <Text style={styles.receiptCountText}>📎 Receipts: {expense.receipts?.length || 0}</Text>
                <Text style={{ color: '#000000', fontWeight: 'bold', fontSize: 12 }}>View Details →</Text>
              </View>
            </TouchableOpacity>
          ))}
          <View style={{ height: 110 }} />
        </ScrollView>
      )}

      {/* FLOATING DOCK */}
      <View style={styles.bottomDockContainer}>
        <View style={styles.bottomDockGlow}>
          <TouchableOpacity style={styles.dockCircleBtn} onPress={() => setSettingsVisible(true)}>
            <Text style={{ fontSize: 18 }}>⚙️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.blackPillDockBtn} onPress={() => setAddModalVisible(true)}>
            <Text style={styles.blackPillBtnText}>+ Add Travel Entry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dockCircleBtn} onPress={() => fetchExpensesFor(currentUser?.id)}>
            <Text style={{ fontSize: 18 }}>⚡</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* MODAL: SETTINGS */}
      <Modal visible={settingsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>⚙️ Backend Server</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}><Text style={{ fontSize: 20, color: '#6E6E73' }}>✕</Text></TouchableOpacity>
            </View>
            {[{ label: '🌐 Render Live Production', url: RENDER_URL }, { label: '📶 Local Wi-Fi (192.168.1.8)', url: LOCAL_WIFI_URL }, { label: '📱 Android Emulator', url: EMULATOR_URL }, { label: '💻 Localhost', url: LOCALHOST_URL }].map(opt => (
              <TouchableOpacity key={opt.url} style={[styles.optionBox, baseUrl === opt.url && styles.optionSelected]} onPress={() => setBaseUrl(opt.url)}>
                <Text style={styles.optionTitle}>{opt.label}</Text>
                <Text style={styles.optionSubtitle}>{opt.url}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.inputLabel}>Custom Wi-Fi / Tunnel URL:</Text>
            <TextInput style={styles.textInput} placeholder="http://192.168.x.x:3000/api" value={customUrlInput} onChangeText={setCustomUrlInput} autoCapitalize="none" />
            <TouchableOpacity style={styles.blackPillBtn} onPress={() => { if (customUrlInput.trim()) setBaseUrl(customUrlInput.trim()); setSettingsVisible(false); }}>
              <Text style={styles.blackPillBtnText}>Save & Reconnect</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL: ADD EXPENSE */}
      <Modal visible={addModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>📝 Add Travel Expense</Text>
                <TouchableOpacity onPress={() => setAddModalVisible(false)}><Text style={{ fontSize: 20, color: '#6E6E73' }}>✕</Text></TouchableOpacity>
              </View>
              <Text style={styles.inputLabel}>Date (YYYY-MM-DD):</Text>
              <TextInput style={styles.textInput} value={formDate} onChangeText={setFormDate} />
              <Text style={styles.inputLabel}>Destination / Location:</Text>
              <TextInput style={styles.textInput} placeholder="e.g. Andheri to BKC" value={formLocation} onChangeText={setFormLocation} />
              <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Category Expenses (₹):</Text>
              {formEntries.map((item, idx) => (
                <View key={idx} style={styles.formRow}>
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '500' }}>{item.type}</Text>
                  <TextInput style={[styles.textInput, { width: 110, marginBottom: 0 }]} placeholder="0" keyboardType="numeric" value={item.amount}
                    onChangeText={val => { const n = [...formEntries]; n[idx].amount = val; setFormEntries(n); }} />
                </View>
              ))}
              <View style={styles.totalPreviewBox}>
                <Text style={{ fontWeight: 'bold' }}>Total:</Text>
                <Text style={{ fontWeight: 'bold', fontSize: 18, color: '#000' }}>
                  ₹{formEntries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toFixed(0)}
                </Text>
              </View>
              <TouchableOpacity style={[styles.blackPillBtn, savingExpense && { opacity: 0.7 }]} disabled={savingExpense} onPress={handleSaveExpense}>
                {savingExpense ? <ActivityIndicator color="#FFF" /> : <Text style={styles.blackPillBtnText}>Save Travel Expense</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* MODAL: EXPENSE DETAIL */}
      {selectedExpense && (
        <Modal visible={!!selectedExpense} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>📍 {selectedExpense.location}</Text>
                <TouchableOpacity onPress={() => setSelectedExpense(null)}><Text style={{ fontSize: 20, color: '#6E6E73' }}>✕</Text></TouchableOpacity>
              </View>
              <Text style={{ color: '#6E6E73', marginBottom: 12 }}>Date: {selectedExpense.date}</Text>
              <View style={styles.detailTotalBox}>
                <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Total:</Text>
                <Text style={{ fontSize: 22, fontWeight: 'bold', color: '#000' }}>₹{(selectedExpense.total || 0).toFixed(0)}</Text>
              </View>
              <Text style={styles.sectionLabel}>Breakdown:</Text>
              {selectedExpense.entries?.map((entry, idx) => (
                <View key={idx} style={styles.detailRow}>
                  <Text style={{ fontSize: 14 }}>{entry.type}</Text>
                  <Text style={{ fontSize: 14, fontWeight: 'bold' }}>₹{entry.amount}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <Text style={styles.sectionLabel}>📎 Receipts ({selectedExpense.receipts?.length || 0})</Text>
                <TouchableOpacity style={styles.smallBlackBtn} onPress={handlePickAndUploadReceipt} disabled={uploadingReceipt}>
                  {uploadingReceipt ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>+ Upload</Text>}
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 120, marginVertical: 8 }}>
                {selectedExpense.receipts?.length > 0
                  ? selectedExpense.receipts.map((r, i) => (
                    <View key={i} style={styles.receiptItem}><Text style={{ fontSize: 12 }}>📄 {r.fileName || 'Receipt'}</Text></View>
                  ))
                  : <Text style={{ color: '#8E8E93', fontSize: 13, marginVertical: 8 }}>No receipts uploaded yet.</Text>}
              </ScrollView>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteExpense(selectedExpense.id)}>
                <Text style={styles.deleteBtnText}>🗑️ Delete Entry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ==================== STYLES ====================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFC' },

  // AUTH
  authScroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 40 },
  authLogoRow: { alignItems: 'center', marginBottom: 32 },
  authLogoText: { fontSize: 28, fontWeight: '800', color: '#000000', letterSpacing: -0.5 },
  authLogoSub: { fontSize: 13, color: '#6E6E73', marginTop: 4 },
  authCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  authTitle: { fontSize: 24, fontWeight: '800', color: '#000000', marginBottom: 6, letterSpacing: -0.4 },
  authSubtitle: { fontSize: 14, color: '#6E6E73', marginBottom: 20 },
  authLink: { color: '#000000', fontWeight: '700', textDecorationLine: 'underline' },
  authEmailHighlight: { fontSize: 15, fontWeight: '700', color: '#000', marginBottom: 16 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#E5E5EA', borderRadius: 14, paddingVertical: 13, marginBottom: 16, backgroundColor: '#FAFAFA' },
  googleBtnIcon: { fontSize: 18, fontWeight: '900', color: '#4285F4', marginRight: 10 },
  googleBtnText: { fontSize: 15, fontWeight: '600', color: '#1C1C1E' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E5EA' },
  dividerText: { fontSize: 11, color: '#8E8E93', marginHorizontal: 10, fontWeight: '500' },
  input: { backgroundColor: '#F4F4F7', borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, marginBottom: 12, color: '#000' },
  otpInput: { backgroundColor: '#F4F4F7', borderWidth: 2, borderColor: '#E5E5EA', borderRadius: 14, paddingVertical: 18, fontSize: 32, fontWeight: '900', letterSpacing: 14, textAlign: 'center', marginBottom: 16 },
  primaryBtn: { backgroundColor: '#000000', paddingVertical: 15, borderRadius: 26, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  backBtn: { marginBottom: 16 },
  backBtnText: { color: '#6E6E73', fontWeight: '600', fontSize: 14 },
  errorMsg: { backgroundColor: '#FFF0F0', color: '#FF3B30', fontSize: 13, padding: 10, borderRadius: 10, marginBottom: 12, fontWeight: '500' },
  serverHint: { textAlign: 'center', fontSize: 12, color: '#8E8E93', marginTop: 16 },

  // DASHBOARD
  header: { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
  headerTitle: { color: '#000000', fontSize: 20, fontWeight: 'bold', letterSpacing: -0.4 },
  headerSubtitle: { color: '#6E6E73', fontSize: 11, marginTop: 2 },
  iconBtn: { marginLeft: 10, padding: 6 },
  summaryCard: { backgroundColor: '#F4F4F7', margin: 16, padding: 20, borderRadius: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  summaryLabel: { color: '#6E6E73', fontSize: 13, fontWeight: '500' },
  summaryValue: { color: '#000000', fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  badgeContainer: { backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E5E5EA' },
  badgeText: { color: '#000000', fontSize: 12, fontWeight: '600' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorTitle: { fontSize: 18, fontWeight: 'bold', color: '#FF3B30', marginTop: 8 },
  errorText: { color: '#6E6E73', textAlign: 'center', marginVertical: 8, fontSize: 13 },
  expenseCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E5E5EA' },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F4F4F7', justifyContent: 'center', alignItems: 'center' },
  locationTitle: { fontSize: 17, fontWeight: 'bold', color: '#000000' },
  dateText: { fontSize: 12, color: '#6E6E73', marginTop: 2 },
  amountText: { fontSize: 20, fontWeight: '800', color: '#000000' },
  breakdownRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 6 },
  chip: { backgroundColor: '#F4F4F7', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  chipText: { fontSize: 12, color: '#1C1C1E', fontWeight: '500' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F4F4F7' },
  receiptCountText: { fontSize: 12, color: '#6E6E73' },
  bottomDockContainer: { position: 'absolute', bottom: 20, left: 20, right: 20, alignItems: 'center' },
  bottomDockGlow: { backgroundColor: 'rgba(255,195,208,0.95)', borderRadius: 36, padding: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', elevation: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  dockCircleBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.85)', justifyContent: 'center', alignItems: 'center' },
  blackPillDockBtn: { backgroundColor: '#000000', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 26, flex: 1, marginHorizontal: 8, alignItems: 'center' },

  // MODALS
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#000000' },
  sectionLabel: { fontSize: 14, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 8 },
  optionBox: { backgroundColor: '#F4F4F7', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E5EA', marginBottom: 8 },
  optionSelected: { backgroundColor: '#EBEBEF', borderColor: '#000000' },
  optionTitle: { fontSize: 14, fontWeight: 'bold', color: '#000000' },
  optionSubtitle: { fontSize: 11, color: '#6E6E73', marginTop: 2 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#1C1C1E', marginTop: 10, marginBottom: 4 },
  textInput: { backgroundColor: '#F4F4F7', borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 10 },
  formRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  totalPreviewBox: { backgroundColor: '#F4F4F7', padding: 14, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 12 },
  detailTotalBox: { backgroundColor: '#F4F4F7', padding: 14, borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  smallBlackBtn: { backgroundColor: '#000000', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  receiptItem: { backgroundColor: '#F4F4F7', padding: 10, borderRadius: 10, marginBottom: 6 },
  deleteBtn: { backgroundColor: '#FFE5E5', paddingVertical: 14, borderRadius: 16, alignItems: 'center', marginTop: 12 },
  deleteBtnText: { color: '#FF3B30', fontWeight: 'bold' },
  blackPillBtn: { backgroundColor: '#000000', paddingVertical: 15, borderRadius: 26, alignItems: 'center', marginTop: 12 },
  blackPillBtnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
});
