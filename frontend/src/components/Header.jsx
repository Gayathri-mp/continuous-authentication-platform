import { useAuth } from '../context/AuthContext'
import './Header.css'

function Header() {
    const { isAuthenticated } = useAuth()

    return (
        <header className="header">
            <div className="logo">
                <div className="logo-icon">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
                        <path d="M12 2L4 5v6c0 5.25 3.5 10.15 8 11.35C16.5 21.15 20 16.25 20 11V5l-8-3z" fill="#00c853" opacity="0.2" stroke="#00c853" strokeWidth="1.5" strokeLinejoin="round"/>
                        <path d="M9 12l2 2 4-4" stroke="#00c853" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </div>
                <h1>YourCredence</h1>
            </div>
            <div className="header-info">
                <span className={`status-badge ${isAuthenticated ? 'authenticated' : ''}`}>
                    {isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
                </span>
            </div>
        </header>
    )
}

export default Header
