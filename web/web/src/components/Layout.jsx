import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import styles from './Layout.module.css'

// Nav items visible to all roles
const NAV_COMMON = [
  { to: '/dashboard',   icon: '⊞',  label: 'Dashboard'    },
  { to: '/work-orders', icon: '⚙',  label: 'Work Orders'  },
  { to: '/assets',      icon: '🏗',  label: 'Assets'       },
  { to: '/pm',          icon: '🔄',  label: 'PM Schedules' },
]

// Only shown to help_desk_agent
const NAV_HELPDESK = [
  { to: '/issues',  icon: '⚑',  label: 'Issue Requests' },
  { to: '/reports', icon: '📊',  label: 'Reports'        },
]

// Admin/manager only
const NAV_ADMIN = [
  { to: '/issues',   icon: '⚑',  label: 'Issues'   },
  { to: '/settings', icon: '⚙',  label: 'Settings' },
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
  const role = user?.role

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Build nav based on role
  let navItems = [...NAV_COMMON]
  if (role === 'help_desk_agent') {
    navItems = [...NAV_COMMON, ...NAV_HELPDESK]
  } else if (role === 'admin' || role === 'manager') {
    navItems = [...NAV_COMMON, ...NAV_ADMIN]
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoText}>MMS<span className={styles.logoDot}>.</span></span>
          <span className={styles.logoSub}>{role === 'help_desk_agent' ? 'Global Help Desk' : 'Company Admin'}</span>
        </div>

        {/* Company */}
        <div className={styles.companyBlock}>
          <div className={styles.companyCard}>
            <span className={styles.companyIcon}>{role === 'help_desk_agent' ? '🌐' : '🏢'}</span>
            <div>
              <div className={styles.companyName}>{user?.company_name ?? 'MMS'}</div>
              <div className={styles.companyRole}>{role === 'help_desk_agent' ? 'Supervisory' : 'Contractor'}</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {navItems.map(item => (
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
          <Avatar name={user?.name ?? 'Admin'} size={30} />
          <div className={styles.userInfo}>
            <div className={styles.userName}>{user?.name ?? 'Admin User'}</div>
            <div className={styles.userRole}>{role}</div>
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
