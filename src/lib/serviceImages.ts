export interface ServiceImagePreset {
  label: string;
  url: string;
}

export const SERVICE_IMAGE_ASSETS = {
  braiding: '/src/assets/images/service_hair_braiding_1795477580054.jpg',
  styling: '/src/assets/images/service_blowdry_styling_1795477580541.jpg',
  barber: '/src/assets/images/service_barber_fade_1795477582385.jpg',
  nails: '/src/assets/images/service_nails_manicure_1795477581060.jpg',
  facial: '/src/assets/images/service_facial_spa_1795477582463.jpg',
  makeup: '/src/assets/images/service_makeup_beauty_1795477581919.jpg',
  defaultTools: '/src/assets/images/salon_tools_still_life_1794932003253.jpg',
} as const;

export const SERVICE_IMAGE_PRESETS: ServiceImagePreset[] = [
  { label: 'Hair Plaiting & Braids', url: SERVICE_IMAGE_ASSETS.braiding },
  { label: 'Blow Dry, Hair Repair & Styling', url: SERVICE_IMAGE_ASSETS.styling },
  { label: 'Barbering, Haircuts & Beard', url: SERVICE_IMAGE_ASSETS.barber },
  { label: 'Manicure, Pedicure & Gel Nails', url: SERVICE_IMAGE_ASSETS.nails },
  { label: 'Facial Treatment, Mask & Massage', url: SERVICE_IMAGE_ASSETS.facial },
  { label: 'Makeup & Beauty Glam', url: SERVICE_IMAGE_ASSETS.makeup },
];

export function resolveServiceImage(service: {
  name?: string;
  categoryId?: string;
  categoryName?: string;
  imageUrl?: string;
}): string {
  const explicit = (service.imageUrl || '').trim();
  if (explicit) return explicit;

  const name = (service.name || '').toLowerCase();
  const cat = `${service.categoryId || ''} ${service.categoryName || ''}`.toLowerCase();

  // Specific service-name overrides first so edge items (e.g. "trimming nails", "hair repair") match accurately
  if (/\b(nail|nails|pedicure|manicure|gel|acrylic|stick\s*on|polish)\b/.test(name)) {
    return SERVICE_IMAGE_ASSETS.nails;
  }
  if (/\b(facial|black\s*mask|mask|scrub|scrubbing|head\s*massage|massage|steam)\b/.test(name)) {
    return SERVICE_IMAGE_ASSETS.facial;
  }
  if (/\b(makeup|bridal|glam|brow|lash)\b/.test(name)) {
    return SERVICE_IMAGE_ASSETS.makeup;
  }
  if (/\b(plait|plaiting|cornrow|braid|box\s*braid|knotless|twist|dread|locs)\b/.test(name)) {
    return SERVICE_IMAGE_ASSETS.braiding;
  }
  if (/\b(beard|shave|fade|haircut|barber|lining)\b/.test(name)) {
    return SERVICE_IMAGE_ASSETS.barber;
  }
  if (/\b(blow\s*dry|blowdry|hair\s*repair|treatment|silk|wig|shampoo|color|dye|tint)\b/.test(name)) {
    return SERVICE_IMAGE_ASSETS.styling;
  }
  if (/\btrimming\b/.test(name) && !cat.includes('nail')) {
    return SERVICE_IMAGE_ASSETS.barber;
  }

  // Category fallback
  if (cat.includes('nail') || cat.includes('cat-nails')) {
    return SERVICE_IMAGE_ASSETS.nails;
  }
  if (cat.includes('facial') || cat.includes('cat-facial')) {
    return SERVICE_IMAGE_ASSETS.facial;
  }
  if (cat.includes('makeup') || cat.includes('cat-makeup')) {
    return SERVICE_IMAGE_ASSETS.makeup;
  }
  if (
    cat.includes('plait') ||
    cat.includes('braid') ||
    cat.includes('lock') ||
    cat.includes('cat-plait') ||
    cat.includes('cat-braids') ||
    cat.includes('cat-locks')
  ) {
    return SERVICE_IMAGE_ASSETS.braiding;
  }
  if (
    cat.includes('cut') ||
    cat.includes('beard') ||
    cat.includes('groom') ||
    cat.includes('kids') ||
    cat.includes('cat-cuts') ||
    cat.includes('cat-beard') ||
    cat.includes('cat-kids') ||
    cat.includes('cat-groom')
  ) {
    return SERVICE_IMAGE_ASSETS.barber;
  }
  if (
    cat.includes('blow') ||
    cat.includes('styl') ||
    cat.includes('wig') ||
    cat.includes('color') ||
    cat.includes('cat-blow') ||
    cat.includes('cat-style') ||
    cat.includes('cat-wig') ||
    cat.includes('cat-color')
  ) {
    return SERVICE_IMAGE_ASSETS.styling;
  }

  return SERVICE_IMAGE_ASSETS.defaultTools;
}
