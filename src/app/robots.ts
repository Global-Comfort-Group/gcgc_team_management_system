import { appUrl } from '@/lib/app-url'
import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = appUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy-policy', '/terms-of-service'],
        disallow: ['/admin/', '/user/', '/api/', '/administrator/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
