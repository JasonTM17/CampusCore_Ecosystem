import { getSiteUrl } from '@/lib/site';
import { getMessages } from '@/i18n/messages';

interface JsonLdProps {
  locale?: string;
  nonce?: string;
}

export function JsonLd({ locale = 'vi', nonce }: JsonLdProps) {
  const siteUrl = getSiteUrl();
  const copy = getMessages(locale === 'vi' ? 'vi' : 'en').meta.jsonLd;

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollegeOrUniversity',
    name: copy.organizationName,
    alternateName: ['HCM-UTE', 'HCMUTE', 'CampusUTE', 'UTE'],
    url: siteUrl,
    logo: `${siteUrl}/icon.png`,
    image: `${siteUrl}/icon.png`,
    description: copy.organizationDescription,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '01 Võ Văn Ngân, Phường Linh Chiểu',
      addressLocality: 'Thành phố Thủ Đức',
      addressRegion: 'Thành phố Hồ Chí Minh',
      addressCountry: 'VN',
    },
    sameAs: [
      'https://hcmute.edu.vn',
      'https://www.facebook.com/hcmute.spkt/',
    ],
  };

  const webAppSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'CampusUTE',
    alternateName: 'CampusUTE Portal',
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'All',
    browserRequirements: 'Requires JavaScript. Requires HTML5.',
    url: siteUrl,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'VND',
    },
    author: {
      '@type': 'EducationalOrganization',
      name: copy.organizationName,
    },
  };

  const webSiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'CampusUTE',
    url: siteUrl,
    inLanguage: ['vi-VN', 'en-US'],
    publisher: {
      '@type': 'CollegeOrUniversity',
      name: copy.organizationName,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }}
      />
    </>
  );
}
