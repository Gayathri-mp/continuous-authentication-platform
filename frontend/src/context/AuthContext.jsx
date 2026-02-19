import { createContext, useContext, useState, useEffect } from 'react'
import { authAPI } from '../services/api'

const AuthContext = createContext(null)

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider')
    }
    return context
}

export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [token, setToken] = useState(null)
    const [sessionId, setSessionId] = useState(null)
    const [username, setUsername] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Check for existing session
        const savedToken = localStorage.getItem('authToken')
        if (savedToken) {
            verifySession(savedToken)
        } else {
            setLoading(false)
        }
    }, [])

    const verifySession = async (authToken) => {
        try {
            const session = await authAPI.getSession(authToken)
            setToken(authToken)
            setSessionId(session.session_id)
            setUsername(session.username)
            setIsAuthenticated(true)
        } catch (error) {
            console.error('Session verification failed:', error)
            localStorage.removeItem('authToken')
        } finally {
            setLoading(false)
        }
    }

    const login = async (authToken, session) => {
        setToken(authToken)
        setSessionId(session.session_id)
        setUsername(session.username)
        setIsAuthenticated(true)
        localStorage.setItem('authToken', authToken)
    }

    const logout = async () => {
        try {
            if (token) {
                await authAPI.logout(token)
            }
        } catch (error) {
            console.error('Logout error:', error)
        } finally {
            setToken(null)
            setSessionId(null)
            setUsername(null)
            setIsAuthenticated(false)
            localStorage.removeItem('authToken')
        }
    }

    const value = {
        isAuthenticated,
        token,
        sessionId,
        username,
        loading,
        login,
        logout
    }

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
