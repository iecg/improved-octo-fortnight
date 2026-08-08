import { zodResolver } from '@hookform/resolvers/zod';
import { Button, ErrorText, Field, Screen, Title } from '@couple/ui';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { signupSchema, type SignupFormValues } from '@/lib/validation';

export default function SignupScreen() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = async (values: SignupFormValues) => {
    setSubmitError(null);
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { full_name: values.fullName } },
    });
    if (error) setSubmitError(error.message);
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        className="flex-1 justify-center gap-4"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="items-center">
          <Title>Create your account</Title>
        </View>

        <Controller
          control={control}
          name="fullName"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Name"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.fullName?.message}
              autoComplete="name"
            />
          )}
        />

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Email"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.email?.message}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.password?.message}
              secureTextEntry
              autoComplete="new-password"
            />
          )}
        />

        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onChange, onBlur, value } }) => (
            <Field
              label="Confirm password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.confirmPassword?.message}
              secureTextEntry
              autoComplete="new-password"
            />
          )}
        />

        {submitError ? <ErrorText>{submitError}</ErrorText> : null}

        <Button label="Sign up" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />

        <Link href="/(auth)/login" className="mt-6 self-center">
          <Text className="text-muted dark:text-muted-dark">Already have an account? Log in</Text>
        </Link>
      </KeyboardAvoidingView>
    </Screen>
  );
}
