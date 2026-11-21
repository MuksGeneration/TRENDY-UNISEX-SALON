import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, Scissors, Calendar } from 'lucide-react';
import { apiFetch, setSalonSessionToken } from '../lib/api';
import { connectGoogleWorkspace } from '../lib/firebaseAuth';
import { PWAInstallButton } from './PWAInstallButton';
import type { SalonBranding, SessionUser } from '../types';

interface LoginViewProps {
  branding?: SalonBranding;
  onSuccess: (user: SessionUser, googleConnected?: boolean) => void;
  onOpenClientBooking?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ branding, onSuccess, onOpenClientBooking }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [imgError, setImgError] = useState(false);

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSalonSessionToken(res.token);
      onSuccess(res.user, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const { accessToken } = await connectGoogleWorkspace();
      const res = await apiFetch<{ token: string; user: SessionUser }>('/api/auth/google-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      setSalonSessionToken(res.token);
      onSuccess(res.user, true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google sign-in failed. Ensure your email is registered in User Management.'
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const salonName = branding?.businessName || 'Trendy Unisex Salon';
  const salonTagline = branding?.tagline || 'Where Beauty Meets Style';
  const audienceTagline = branding?.audienceTagline || 'For Him · For Her · For Everyone';
  const bookingPhone = branding?.phone || '0740301726';
  const socialHandle = branding?.socialHandle || '@Trendyunisex.salon';
  const socialPlatforms = (branding?.socialPlatforms || ['TikTok', 'Instagram', 'Facebook']).join(' · ');
  const walkInsWelcome = branding?.walkInsWelcome !== false;
  const locationText = branding?.location || "Busia District Road, near ASA Microfinance, Madibira 'A', Uganda";
  const bannerUrl =
    branding?.promotionalBannerUrl || '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg';
  const backgroundUrl =
    branding?.backgroundImageUrl ||
    '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg';

  return (
    <div className="min-h-screen bg-[#F8EEEB] flex flex-col lg:flex-row">
      {/* Left Brand Editorial Panel */}
      <div className="relative lg:w-1/2 min-h-[340px] lg:min-h-screen bg-[#1D1717] overflow-hidden flex flex-col justify-between p-7 lg:p-12">
        {!imgError && backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt="Trendy Unisex Salon storefront on Busia District Road, Madibira 'A'"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-70"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1D1717] via-[#3A1B29] to-[#E83B84]/40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1D1717]/92 via-[#1D1717]/55 to-[#1D1717]/70" />

        <div className="relative z-10 flex items-center gap-3">
          {branding?.salonLogoUrl ? (
            <img
              src={branding.salonLogoUrl}
              alt={`${salonName} logo`}
              className="w-11 h-11 rounded-xl object-contain bg-white p-1 border border-white/25 shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-[#E83B84] flex items-center justify-center text-white shrink-0">
              <Scissors className="w-5 h-5" />
            </div>
          )}
          <div>
            <div className="text-white font-semibold tracking-wide text-sm uppercase">
              {salonName}
            </div>
            <div className="text-[#F3BFD3] text-xs">
              {locationText}
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-xl my-8 lg:my-0 space-y-5">
          <div>
            <p className="text-[#F3BFD3] text-xs font-semibold uppercase tracking-wider mb-1.5">
              {audienceTagline}{walkInsWelcome ? ' · Walk-Ins Welcome' : ''}
            </p>
            <p className="text-white/90 text-sm font-medium tracking-wide mb-2">
              {salonTagline}
            </p>
            <h1 className="text-3xl lg:text-4xl font-bold text-white leading-tight text-balance">
              Complete Salon Operations, POS &amp; Financial Control.
            </h1>
            <p className="text-white/80 text-sm mt-3 leading-relaxed max-w-lg">
              Hair Styling, Braids &amp; Cornrows, Wig Installation, Makeup, Nails, Facial Treatment,
              Haircuts, Beard Trimming, Hair Coloring, Dreadlocks, Kids Cuts &amp; Grooming.
            </p>
          </div>

          {bannerUrl && (
            <div className="rounded-2xl overflow-hidden border border-white/15 bg-white/5 shadow-lg">
              <img
                src={bannerUrl}
                alt={`${salonName} promotional showcase`}
                referrerPolicy="no-referrer"
                className="w-full aspect-[2/1] object-cover block"
              />
            </div>
          )}
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/80 border-t border-white/15 pt-4">
          <span className="font-mono font-semibold text-[#F3BFD3]">Book: {bookingPhone}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{socialHandle} ({socialPlatforms})</span>
          <span aria-hidden="true">&middot;</span>
          <span>Currency: Uganda Shillings (UGX)</span>
        </div>
      </div>

      {/* Right Sign-In Form */}
      <div className="relative lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-16 overflow-hidden">
        {!imgError && backgroundUrl && (
          <>
            <img
              src={backgroundUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
            />
            <div className="absolute inset-0 bg-[#F8EEEB]/75 pointer-events-none" />
          </>
        )}
        <div className="relative z-10 w-full max-w-md bg-white/95 backdrop-blur-xs border border-[#1D1717]/10 rounded-2xl p-7 sm:p-9 shadow-sm">
          <div className="mb-7">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold tracking-wider text-[#E83B84] uppercase">
                {salonName}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <PWAInstallButton variant="login" />
                {onOpenClientBooking && (
                  <button
                    type="button"
                    onClick={onOpenClientBooking}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8EEEB] hover:bg-[#F3BFD3]/60 border border-[#E83B84]/25 text-xs font-semibold text-[#1D1717] transition-colors cursor-pointer"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[#E83B84]" />
                    <span>Client Booking View</span>
                  </button>
                )}
              </div>
            </div>
            <h2 className="text-2xl font-bold text-[#1D1717]">Staff &amp; Management Sign In</h2>
            <p className="text-sm text-[#1D1717]/65 mt-1">
              {salonTagline} &middot; Sign in to access your role workspace.
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleCredentialLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#1D1717] mb-1.5">
                Staff Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#1D1717]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your staff email"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#F8EEEB]/60 border border-[#1D1717]/15 rounded-xl focus:outline-none focus:border-[#E83B84] focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1D1717] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#1D1717]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-[#F8EEEB]/60 border border-[#1D1717]/15 rounded-xl focus:outline-none focus:border-[#E83B84] focus:bg-white transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1D1717]/45 hover:text-[#1D1717]"
                  aria-label="Toggle password visibility"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-5 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white font-semibold text-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Signing in...' : 'Sign In to Salon System'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1D1717]/10" />
            <span className="text-xs text-[#1D1717]/45">or continue with Google Workspace</span>
            <div className="h-px flex-1 bg-[#1D1717]/10" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="gsi-material-button"
          >
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {googleLoading ? 'Connecting Google...' : 'Sign in with Google'}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
