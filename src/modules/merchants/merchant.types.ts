export type Merchant = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  distanceKm: number;
  serviceRadiusKm: number;
  priceHint: string;
  responseTime: string;
  phone: string;
  verified: boolean;
  availableNow: boolean;
};
