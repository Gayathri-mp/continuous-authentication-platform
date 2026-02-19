import { useState, useEffect } from 'react'
import Header from './components/Header'
import AuthView from './components/AuthView'
import Dashboard from './components/Dashboard'
import Toast from './components/Toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './hooks/useToast'
import './App.css'

function AppContent() {
    const { isAuthenticated } = useAuth()

    return (
        <div className="app">
            <div className="container">
                <Header />
                <main className="main-content">
                    {isAuthenticated ? <Dashboard /> : <AuthView />}
                </main>
            </div>
            <Toast />
        </div>
    )
}

function App() {
    return (
        <AuthProvider>
            <ToastProvider>
                <AppContent />
            </ToastProvider>
        </AuthProvider>
    )
}

export default App
