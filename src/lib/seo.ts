import type { NavSection, SalonBranding } from '../types';

interface SeoContext {
  branding: SalonBranding;
  activeSection: NavSection;
  isAuthenticated: boolean;
  showClientBooking: boolean;
}

const DEFAULT_DESCRIPTION =
  'Book hair, barbering, and beauty appointments or manage POS billing, staff commissions, and salon inventory at Trendy Unisex Salon in Busia, Uganda.';

const SECTION_SEO: Partial<Record<NavSection, { title: string; description: string }>> = {
  dashboard: {
    title: 'Salon Dashboard – Trendy Unisex Salon Management',
    description:
      'Monitor daily revenue, client appointments, staff commissions, and low-stock alerts at Trendy Unisex Salon in Busia District, Uganda.',
  },
  appointments: {
    title: 'Appointments & Walk-Ins – Trendy Unisex Salon',
    description:
      'Schedule salon bookings, manage walk-in queues, assign stylists, and check clients into POS seamlessly at Trendy Unisex Salon.',
  },
  pos: {
    title: 'POS & Checkout Billing – Trendy Unisex Salon',
    description:
      'Process client services and retail product sales, split payments, apply gift cards, and print receipts in UGX at Trendy Unisex Salon.',
  },
  customers: {
    title: 'Client CRM & Loyalty – Trendy Unisex Salon',
    description:
      'Manage customer profiles, visit history, loyalty points, and preferred stylists for returning guests at Trendy Unisex Salon.',
  },
  employees: {
    title: 'Staff & Payroll Profiles – Trendy Unisex Salon',
    description:
      'Manage stylist profiles, schedules, roles, and performance records for the Trendy Unisex Salon team in Busia, Uganda.',
  },
  services: {
    title: 'Salon Services & Pricing – Trendy Unisex Salon',
    description:
      'Browse and configure hair styling, braiding, barbering, skincare, and beauty treatments with UGX pricing and commission rates.',
  },
  commissions: {
    title: 'Staff Commission Ledger – Trendy Unisex Salon',
    description:
      'Track stylist earnings, automated commission splits, daily lunch deductions, and verified payouts at Trendy Unisex Salon.',
  },
  inventory: {
    title: 'Salon Inventory & Stock – Trendy Unisex Salon',
    description:
      'Track salon-owned supplies and retail products for sale, monitor stock-low alerts, and log stock movements in real time.',
  },
  expenses: {
    title: 'Salon Expenses & Approvals – Trendy Unisex Salon',
    description:
      'Record operational salon expenses, utilities, and supply costs with owner approval tracking at Trendy Unisex Salon.',
  },
  'gift-cards': {
    title: 'Gift Cards & Vouchers – Trendy Unisex Salon',
    description:
      'Issue, redeem, and track digital gift cards and prepaid beauty vouchers for clients at Trendy Unisex Salon.',
  },
  reports: {
    title: 'Financial Reports & Analytics – Trendy Unisex Salon',
    description:
      'Export revenue summaries, expense ledgers, commission payouts, and inventory valuations in PDF or Excel at Trendy Unisex Salon.',
  },
  settings: {
    title: 'Salon Settings & Sync – Trendy Unisex Salon',
    description:
      'Configure branding, tax, commission policies, and Google Workspace cloud sync for Trendy Unisex Salon.',
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

  let title = `${businessName} Management System`;
  let description = DEFAULT_DESCRIPTION;

  if (!isAuthenticated && showClientBooking) {
    title = `Book Appointment – ${businessName} Busia`;
    description = `Book hair styling, braiding, barbering, and beauty treatments online at ${businessName} in Busia District, Uganda. Walk-ins welcome.`;
  } else if (isAuthenticated && SECTION_SEO[activeSection]) {
    title = SECTION_SEO[activeSection]!.title;
    description = SECTION_SEO[activeSection]!.description;
  }

  const imageUrl = resolveAbsoluteAssetUrl(origin, branding.promotionalBannerUrl);
  const imageAlt = `${businessName} – ${branding.tagline || 'Where Beauty Meets Style'}`;

  document.title = title;
  upsertLink('canonical', canonicalUrl);

  upsertMeta('name', 'description', description);
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
