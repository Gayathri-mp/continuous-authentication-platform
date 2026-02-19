import { useAuth } from '../context/AuthContext'
import './Header.css'

function Header() {
    const { isAuthenticated } = useAuth()

    return (
        <header className="header">
            <div className="logo">
                <div className="logo-icon">🔐</div>
                <h1>Adaptive Auth</h1>
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
