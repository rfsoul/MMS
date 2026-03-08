// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authApi, NetworkError } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { fullSync } from '@/services/syncEngine';

export default function LoginScreen() {
  const router  = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleLogin() {
    if (!email.trim() || !password) { setError('Email and password required'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login(email.trim(), password);

      // If the API requires a password change, handle it
      if ((res as any).must_change_password) {
        Alert.alert('Password Change Required', 'Please update your password on the web portal before using the mobile app.');
        setLoading(false);
        return;
      }

      await setAuth(res.token, res.user);
      // Initial data pull — best-effort (may fail if just came online)
      fullSync().catch(() => {});
      router.replace('/(app)/work-orders');
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Cannot reach server — check WiFi connection');
      } else {
        setError('Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.org}>Acme Facilities Management</Text>
        <Text style={styles.heading}>MMS{'\n'}Field App</Text>
        <View style={styles.rule} />

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholderTextColor="#555"
            placeholder="technician@acme.com"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            placeholderTextColor="#555"
            placeholder="••••••••"
          />
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#0d0d0f" />
            : <Text style={styles.btnText}>Sign In</Text>
          }
        </TouchableOpacity>

        <Text style={styles.version}>MMS v1.0.0 · Internal Use Only</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#0d0d0f' },
  inner:      { flex: 1, justifyContent: 'center', padding: 28 },
  org:        { fontSize: 11, letterSpacing: 1.8, color: '#555', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'monospace' },
  heading:    { fontSize: 32, fontWeight: '700', color: '#e8e4dc', lineHeight: 36, marginBottom: 8, fontFamily: 'monospace' },
  rule:       { width: 40, height: 2, backgroundColor: '#f0a500', marginBottom: 36 },
  field:      { marginBottom: 16 },
  label:      { fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#555', marginBottom: 6, fontFamily: 'monospace' },
  input:      { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, padding: 13, color: '#e8e4dc', fontSize: 14, fontFamily: 'monospace' },
  error:      { color: '#ff4444', fontSize: 12, marginBottom: 10, letterSpacing: 0.4, fontFamily: 'monospace' },
  btn:        { backgroundColor: '#f0a500', borderRadius: 4, padding: 15, alignItems: 'center', marginTop: 8 },
  btnDisabled:{ opacity: 0.6 },
  btnText:    { color: '#0d0d0f', fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: 'monospace' },
  version:    { marginTop: 28, fontSize: 10, color: '#333', textAlign: 'center', letterSpacing: 0.8, fontFamily: 'monospace' },
});
