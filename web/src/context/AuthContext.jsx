import { createContext, useContext, useState, useCallback } from 'react'
import { auth, setToken, clearToken, getToken } from '../services/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    // Restore session from sessionStorage on page load
    const stored = sessionStorage.getItem('mms_user')
    return stored ? JSON.parse(stored) : null
  })

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const login = useCallback(async (email, password) => {
    setLoading(true)
    setError(null)
    try {
      const res = await auth.login(email, password)
      setToken(res.token)
      sessionStorage.setItem('mms_user', JSON.stringify(res.user))
      setUser(res.user)
      return res.user
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try { await auth.logout() } catch (_) {}
    clearToken()
    sessionStorage.removeItem('mms_user')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
