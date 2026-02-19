import { useToast } from '../hooks/useToast'
import './Toast.css'

function Toast() {
    const { toast } = useToast()

    if (!toast) return null

    return (
        <div className={`toast ${toast.type} active`}>
            {toast.message}
        </div>
    )
}

export default Toast
