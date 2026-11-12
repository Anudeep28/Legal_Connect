export type PaidPlan = 'single' | 'monthly';
export type UserRole = 'client' | 'lawyer' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  accountStatus: 'active' | 'suspended' | 'deactivated';
  phone?: string;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  lawyerProfile?: Lawyer;
  subscriptionStatus: 'active' | 'trial' | 'expired';
  subscriptionPlan: 'trial' | PaidPlan;
  subscriptionExpiry?: Date;
  documentCredits: number;
  appliedPaymentIds: string[];
  emailNotifications?: boolean;
  pushNotifications?: boolean;
}

export interface Lawyer {
  id: string;
  slug: string;
  name: string;
  title: string;
  bio: string;
  practiceAreas: string[];
  languages: string[];
  experienceYears: number;
  barCouncil: string;
  enrollmentNumber: string;
  fee: number;
  documentFeePercent: number;
  rating: number;
  reviewCount: number;
  isVerified: boolean;
  approvalStatus: 'draft' | 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  avatarUrl?: string;
  availability: { days: number[]; start: string; end: string };
  reviews?: LawyerReview[];
}

export interface LawyerReview {
  id: string;
  rating: number;
  comment: string;
  clientName?: string;
  createdAt: string;
}

export interface Consultation {
  id: string;
  startsAt: string;
  endsAt: string;
  topic: string;
  notes: string;
  mode: 'chat' | 'call';
  package: 'call_only' | 'call_with_document';
  status: 'pending_payment' | 'booked' | 'cancelled' | 'completed';
  meetingUrl?: string;
  transcript?: string;
  lawyer: Lawyer;
  client?: Pick<User, 'id' | 'name' | 'email'>;
  review?: LawyerReview;
  canReview?: boolean;
}

export interface Deliverable {
  id: string;
  consultationId: string;
  documentId?: string;
  title: string;
  content: string;
  status: 'draft' | 'delivered';
  deliveredAt?: string;
  createdAt: string;
  document?: Document;
}

export interface ConsultationMessage {
  id: string;
  consultationId: string;
  sender: 'user' | 'lawyer' | 'system';
  content: string;
  createdAt: string;
}

export interface LegalTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  content: string;
  fields: TemplateField[];
}

export interface TemplateField {
  id: string;
  name: string;
  type: 'text' | 'textarea' | 'date' | 'number' | 'select';
  placeholder?: string;
  required: boolean;
  options?: string[];
}

export interface Document {
  id: string;
  title: string;
  content: string;
  templateId?: string;
  category?: string;
  language?: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export interface TranscriptionSession {
  id: string;
  documentId: string;
  isRecording: boolean;
  isPaused: boolean;
  language: string;
  outputLanguage: string;
  apiKey: string;
}

export interface Notification {
  id: string;
  userId: string;
  consultationId?: string;
  type: 'CONSULTATION_REMINDER' | 'CONSULTATION_BOOKED' | 'CHAT_MESSAGE' | 'DELIVERABLE_READY';
  channels: ('IN_APP' | 'EMAIL' | 'PUSH')[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
  consultation?: Pick<Consultation, 'id' | 'topic' | 'mode' | 'startsAt'>;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export interface ExportFormat {
  type: 'docx' | 'pdf' | 'markdown';
  filename: string;
}
