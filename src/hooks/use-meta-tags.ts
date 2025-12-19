import { useEffect } from "react";

interface MetaTagsConfig {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: string;
  phone?: string;
  storeName?: string;
}

export const useMetaTags = (config: MetaTagsConfig) => {
  useEffect(() => {
    const {
      title,
      description,
      image,
      url,
      type = "website",
      phone,
      storeName
    } = config;

    // Build enhanced description for stores
    let enhancedDescription = description || "";
    if (storeName && phone) {
      enhancedDescription = `Shop at ${storeName}! Contact us on WhatsApp: ${phone}. ${description || "Browse our products and buy directly."}`;
    }

    // Update document title
    if (title) {
      document.title = title;
    }

    // Helper to update or create meta tag
    const updateMeta = (
      property: string,
      content: string,
      isName = false
    ) => {
      const selector = isName
        ? `meta[name="${property}"]`
        : `meta[property="${property}"]`;
      let element = document.querySelector(selector) as HTMLMetaElement;

      if (!element) {
        element = document.createElement("meta");
        if (isName) {
          element.setAttribute("name", property);
        } else {
          element.setAttribute("property", property);
        }
        document.head.appendChild(element);
      }
      element.setAttribute("content", content);
    };

    // Update Open Graph tags
    if (title) {
      updateMeta("og:title", title);
      updateMeta("twitter:title", title);
    }

    if (enhancedDescription) {
      updateMeta("description", enhancedDescription, true);
      updateMeta("og:description", enhancedDescription);
      updateMeta("twitter:description", enhancedDescription);
    }

    if (image) {
      updateMeta("og:image", image);
      updateMeta("twitter:image", image);
    }

    if (url) {
      updateMeta("og:url", url);
    }

    if (type) {
      updateMeta("og:type", type);
    }

    // Cleanup function to reset meta tags
    return () => {
      document.title = "Tech Fusion Solutions - Create Your Online Store in Minutes";
    };
  }, [config.title, config.description, config.image, config.url, config.type, config.phone, config.storeName]);
};
