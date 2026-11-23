import type { NavSection, SalonBranding } from '../types';

interface SeoContext {
  branding: SalonBranding;
  activeSection: NavSection;
  isAuthenticated: boolean;
  showClientBooking: boolean;
}

interface SeoEntry {
  title: string;
  description: string;
  keywords: string;
}

const DEFAULT_DESCRIPTION =
  'Book hair styling, braiding, barbering, and beauty services or manage POS billing and inventory at Trendy Unisex Salon in Busia, Uganda.';

const DEFAULT_KEYWORDS =
  'Trendy Unisex Salon, hair styling Busia, barbering Busia Uganda, unisex hair salon, hair braiding, fades and haircuts, beauty treatments, salon booking Busia, salon POS Uganda';

const BOOKING_KEYWORDS =
  'book hair styling Busia, barber shop Busia Uganda, fades and haircuts, braiding and twists, manicure pedicure, beauty treatments Madibira, walk-in unisex salon';

const SECTION_SEO: Record<NavSection, SeoEntry> = {
  dashboard: {
    title: 'Hair Styling & Barbering Hub – Trendy Unisex Salon',
    description:
      'Oversee daily hair styling, barbering bookings, retail sales, stylist commissions, and salon performance at Trendy Unisex Salon in Busia.',
    keywords:
      'hair styling dashboard, barbering management, Trendy Unisex Salon Busia, salon revenue tracker, beauty lounge analytics',
  },
  appointments: {
    title: 'Hair & Barber Appointments – Trendy Unisex Salon',
    description:
      'Book and manage hair styling, braiding, fades, barbering sessions, and walk-in queues with stylist assignments in Busia, Uganda.',
    keywords:
      'hair appointment booking, barbering schedule Busia, walk-in hair salon, braiding appointments, Trendy Unisex Salon',
  },
  pos: {
    title: 'Salon POS & Retail Billing – Trendy Unisex Salon',
    description:
      'Bill hair styling, barbering services, and retail haircare products with split payments, gift cards, and UGX receipts at Trendy Unisex Salon.',
    keywords:
      'salon POS billing, hair styling checkout, barber shop payment Uganda, retail beauty products POS, UGX salon receipts',
  },
  customers: {
    title: 'Salon Client CRM & Loyalty – Trendy Unisex Salon',
    description:
      'Track client hair styling preferences, barbering visits, loyalty points, and returning beauty guests at Trendy Unisex Salon.',
    keywords:
      'salon client CRM, hair styling preferences, barbering regulars, salon loyalty points Uganda, beauty client history',
  },
  employees: {
    title: 'Stylists & Barbers Directory – Trendy Unisex Salon',
    description:
      'Manage hair stylists, braiders, barbers, beauty specialists, and staff profiles for Trendy Unisex Salon in Busia District, Uganda.',
    keywords:
      'hair stylists Busia, professional barbers Uganda, salon staff profiles, hair braiders Madibira, Trendy Unisex Salon team',
  },
  scheduling: {
    title: 'Stylist & Barber Shifts – Trendy Unisex Salon',
    description:
      'Plan weekly shifts and chair availability for hair stylists, barbers, and beauty technicians at Trendy Unisex Salon.',
    keywords:
      'stylist shift schedule, barber roster Busia, salon staff availability, hair salon scheduling Uganda',
  },
  attendance: {
    title: 'Stylist & Barber Attendance – Trendy Unisex Salon',
    description:
      'Monitor daily clock-ins, attendance status, and floor coverage for stylists and barbers at Trendy Unisex Salon.',
    keywords:
      'salon staff attendance, barber clock-in tracker, hair salon roster Busia, daily team check-in',
  },
  services: {
    title: 'Hair Styling, Braiding & Barbering – Trendy Salon',
    description:
      'Explore hair styling, braiding, men’s barbering cuts, fades, coloring, and beauty treatments with UGX pricing at Trendy Unisex Salon.',
    keywords:
      'hair styling services, barbering and fades Busia, braiding price list Uganda, keratin hair treatment, manicure pedicure Busia',
  },
  commissions: {
    title: 'Stylist & Barber Commissions – Trendy Unisex Salon',
    description:
      'Calculate transparent commissions earned from hair styling, braiding, and barbering services at Trendy Unisex Salon.',
    keywords:
      'stylist commission tracker, barber earnings Uganda, salon commission splits, hair salon payroll Busia',
  },
  payments: {
    title: 'Stylist & Barber Payouts – Trendy Unisex Salon',
    description:
      'Review and settle commission payouts for hair stylists, braiders, and barbers in cash or mobile money at Trendy Unisex Salon.',
    keywords:
      'salon staff payouts, barber commission payment, mobile money salon payroll, stylist earnings Uganda',
  },
  lunch: {
    title: 'Staff Lunch & Deductions – Trendy Unisex Salon',
    description:
      'Manage daily staff lunch allowances and automated deductions alongside stylist and barber earnings at Trendy Unisex Salon.',
    keywords:
      'salon lunch deductions, stylist meal allowance, barber payroll deductions, salon operations Uganda',
  },
  expenses: {
    title: 'Salon Expenses & Approvals – Trendy Unisex Salon',
    description:
      'Record salon operating costs, styling tools, utilities, and owner approvals cleanly in UGX at Trendy Unisex Salon.',
    keywords:
      'salon expense tracking, beauty salon accounting Uganda, hair shop utility costs, expense approvals Busia',
  },
  inventory: {
    title: 'Salon Supplies & Retail Stock – Trendy Unisex Salon',
    description:
      'Manage salon-owned barbering and styling supplies separately from retail haircare items for sale with live low-stock alerts.',
    keywords:
      'salon inventory management, haircare retail stock Uganda, barber supplies tracker, beauty product stock alerts',
  },
  'gift-cards': {
    title: 'Hair & Beauty Gift Cards – Trendy Unisex Salon',
    description:
      'Issue and redeem prepaid gift cards for hair styling, braiding, barbering, and beauty treatments at Trendy Unisex Salon.',
    keywords:
      'salon gift cards Uganda, beauty voucher Busia, barber shop gift certificate, Trendy Unisex Salon gifts',
  },
  reports: {
    title: 'Salon Revenue & Reports – Trendy Unisex Salon',
    description:
      'Analyze hair styling, barbering, and retail sales performance and export PDF or Excel financial reports at Trendy Unisex Salon.',
    keywords:
      'salon financial reports, hair styling revenue analytics, barbering profit report Uganda, salon Excel PDF export',
  },
  'ai-assistant': {
    title: 'Salon Operations Insights – Trendy Unisex Salon',
    description:
      'Review actionable business insights across hair styling demand, barbering peak hours, commissions, and stock levels.',
    keywords:
      'salon business insights, hair styling demand analytics, barber shop operations Uganda, Trendy Unisex Salon',
  },
  notifications: {
    title: 'Booking & Stock Alerts – Trendy Unisex Salon',
    description:
      'Stay updated on new hair styling and barbering appointments, low-stock warnings, and staff activity at Trendy Unisex Salon.',
    keywords:
      'salon booking alerts, low stock notifications, hair appointment updates, Trendy Unisex Salon alerts',
  },
  users: {
    title: 'Salon Team Access & Roles – Trendy Unisex Salon',
    description:
      'Manage owner, manager, stylist, and barber user accounts with secure password controls at Trendy Unisex Salon.',
    keywords:
      'salon user roles, stylist portal accounts, salon access control, Trendy Unisex Salon staff login',
  },
  settings: {
    title: 'Salon Branding & Settings – Trendy Unisex Salon',
    description:
      'Configure salon branding, hair styling commission policies, tax rules, and cloud sync at Trendy Unisex Salon.',
    keywords:
      'salon settings, hair salon branding Busia, commission policy setup, Google Sheets salon sync',
  },
  'audit-logs': {
    title: 'Salon Security & Audit Trail – Trendy Unisex Salon',
    description:
      'Inspect staff actions, POS reversals, inventory updates, and login activity across Trendy Unisex Salon.',
    keywords:
      'salon audit logs, POS security trail, inventory change history, Trendy Unisex Salon admin',
  },
};

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function resolveAbsoluteAssetUrl(origin: string, url?: string): string {
  const fallback = '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg';
  const raw = (url || '').trim() || fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${origin}${path}`;
}

export function applySeoMetadata({
  branding,
  activeSection,
  isAuthenticated,
  showClientBooking,
}: SeoContext) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const businessName = branding.businessName?.trim() || 'Trendy Unisex Salon';
  const origin = window.location.origin;
  const basePath = window.location.pathname || '/';
  const canonicalUrl = showClientBooking
    ? `${origin}${basePath}?view=book`
    : `${origin}${basePath}`;

  let title = `${businessName} – Hair Styling & Barbering`;
  let description = DEFAULT_DESCRIPTION;
  let keywords = DEFAULT_KEYWORDS;

  if (!isAuthenticated && showClientBooking) {
    title = `Book Hair Styling & Barbering – ${businessName}`;
    description = `Book hair styling, braiding, fades, barbering, and beauty treatments online at ${businessName} in Busia, Uganda. Walk-ins welcome.`;
    keywords = BOOKING_KEYWORDS;
  } else if (isAuthenticated) {
    const entry = SECTION_SEO[activeSection];
    title = entry.title;
    description = entry.description;
    keywords = entry.keywords;
  }

  const imageUrl = resolveAbsoluteAssetUrl(origin, branding.promotionalBannerUrl);
  const imageAlt = `${businessName} – ${branding.tagline || 'Where Beauty Meets Style'}`;

  document.title = title;
  upsertLink('canonical', canonicalUrl);

  upsertMeta('name', 'description', description);
  upsertMeta('name', 'keywords', keywords);
  upsertMeta('property', 'og:type', 'website');
  upsertMeta('property', 'og:site_name', businessName);
  upsertMeta('property', 'og:title', title);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:url', canonicalUrl);
  upsertMeta('property', 'og:image', imageUrl);
  upsertMeta('property', 'og:image:alt', imageAlt);

  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', title);
  upsertMeta('name', 'twitter:description', description);
  upsertMeta('name', 'twitter:image', imageUrl);
  upsertMeta('name', 'twitter:image:alt', imageAlt);

  const jsonLdEl = document.getElementById('salon-jsonld');
  if (jsonLdEl) {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': ['HairSalon', 'BeautySalon'],
          name: businessName,
          slogan: branding.tagline || 'Where Beauty Meets Style',
          description,
          keywords,
          knowsAbout: [
            'Hair Styling',
            'Hair Braiding',
            'Barbering & Fades',
            'Hair Treatments',
            'Manicure & Pedicure',
            'Skincare & Beauty',
          ],
          url: origin,
          image: imageUrl,
          telephone: branding.phone || '0740301726',
          priceRange: 'UGX',
          address: {
            '@type': 'PostalAddress',
            streetAddress:
              branding.location ||
              "Busia District Road, near ASA Microfinance, Madibira 'A'",
            addressLocality: 'Busia',
            addressRegion: 'Eastern Region',
            addressCountry: 'UG',
          },
          openingHoursSpecification: [
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: [
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
                'Sunday',
              ],
              opens: '08:00',
              closes: '21:00',
            },
          ],
          potentialAction: {
            '@type': 'ReserveAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${origin}/?view=book`,
            },
            name: 'Book Salon Appointment',
          },
        },
        {
          '@type': 'WebApplication',
          name: `${businessName} Management System`,
          url: origin,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'All',
          description,
          keywords,
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'UGX',
          },
        },
      ],
    };
    jsonLdEl.textContent = JSON.stringify(graph);
  }
}
