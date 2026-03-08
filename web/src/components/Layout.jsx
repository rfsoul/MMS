import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import styles from './Layout.module.css'

const NAV = [
  { to: '/work-orders', icon: '⚙️',  label: 'Work Orders' },
  { to: '/pm',          icon: '🔄',  label: 'PM Schedules' },
  { to: '/assets',      icon: '🏗️',  label: 'Assets'       },
  { to: '/reports',     icon: '📊',  label: 'Reports'      },
  { to: '/settings',    icon: '⚙️',  label: 'Settings'     },
]

function Avatar({ name, size = 30 }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const hue = name.charCodeAt(0) * 17 % 360
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},55%,80%)`, color: `hsl(${hue},50%,28%)`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
    }}>{initials}</span>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoText}>MMS<span className={styles.logoDot}>.</span></span>
          <span className={styles.logoSub}>Company Admin</span>
        </div>

        {/* Company */}
        <div className={styles.companyBlock}>
          <div className={styles.companyCard}>
            <span className={styles.companyIcon}>🏛️</span>
            <div>
              <div className={styles.companyName}>{user?.company_name || 'National Gallery'}</div>
              <div className={styles.companyRole}>Facilities</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className={styles.userBlock}>
          <Avatar name={user?.name || 'Admin'} size={30} />
          <div className={styles.userInfo}>
            <div className={styles.userName}>{user?.name || 'Admin User'}</div>
            <div className={styles.userRole}>{user?.role || 'company_admin'}</div>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out">↩</button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
