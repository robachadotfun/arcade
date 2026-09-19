import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import {AdminDashboard} from '@/components/admin/AdminDashboard'
import {isAdminEnabled} from '@/lib/adminAuth'

export const metadata: Metadata = {
  title: 'Admin',
  robots: {index: false, follow: false},
}

export default function AdminPage() {
  // The route does not exist at all unless an admin key is configured, so an unconfigured
  // deployment does not advertise an admin surface to probe.
  if (!isAdminEnabled()) notFound()
  return <AdminDashboard />
}
