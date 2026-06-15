import { z } from 'zod';

export const createUserSchema = z
  .object({
    firstName:       z.string().min(1, 'First name is required'),
    lastName:        z.string().min(1, 'Last name is required'),
    middleName:      z.string().optional(),
    username:        z
      .string()
      .min(3, 'At least 3 characters')
      .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dots, dashes, underscores only'),
    email:           z.string().email('Enter a valid email address'),
    role:            z.enum(['ENCODER', 'RELEASING_STAFF'], {
      required_error: 'Role is required',
    }),
    password:        z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
