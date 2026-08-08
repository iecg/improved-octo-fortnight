import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Name is required'),
    email: z.string().trim().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });
export type SignupFormValues = z.infer<typeof signupSchema>;

export const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, 'Household name is required').max(60),
});
export type CreateHouseholdFormValues = z.infer<typeof createHouseholdSchema>;

export const joinHouseholdSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, 'Invite codes are 6 characters')
    .max(6, 'Invite codes are 6 characters')
    .transform((v) => v.toUpperCase()),
});
export type JoinHouseholdFormValues = z.infer<typeof joinHouseholdSchema>;

export const choreFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(80),
    description: z.string().trim().max(300).optional(),
    cadenceType: z.enum(['daily', 'weekly_days', 'every_n_days', 'monthly']),
    weekdays: z.array(z.number().min(0).max(6)).optional(),
    everyNDays: z.number().int().min(1).max(365).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    startDate: z.string(),
    assignmentType: z.enum(['fixed', 'rotating']),
    fixedAssigneeId: z.string().uuid().optional(),
  })
  .refine((data) => data.cadenceType !== 'weekly_days' || (data.weekdays?.length ?? 0) > 0, {
    message: 'Select at least one weekday',
    path: ['weekdays'],
  })
  .refine((data) => data.assignmentType !== 'fixed' || !!data.fixedAssigneeId, {
    message: 'Choose who this chore is fixed to',
    path: ['fixedAssigneeId'],
  });
export type ChoreFormValues = z.infer<typeof choreFormSchema>;
