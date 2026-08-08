import { zodResolver } from '@hookform/resolvers/zod';
import { Button, ErrorText, Field, Screen, Title } from '@couple/ui';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { loginSchema, type LoginFormValues } from '@/lib/validation';

export default function LoginScreen() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) setSubmitError(error.message);
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        className="flex-1 justify-center gap-4"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="items-center">
          <Title>Welcome back</Title>
        </View>

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
              autoComplete="password"
            />
          )}
        />

        {submitError ? <ErrorText>{submitError}</ErrorText> : null}

        <Button label="Log in" onPress={handleSubmit(onSubmit)} loading={isSubmitting} />

        <Link href="/(auth)/signup" className="mt-6 self-center">
          <Text className="text-muted dark:text-muted-dark">
            Don&apos;t have an account? Sign up
          </Text>
        </Link>
      </KeyboardAvoidingView>
    </Screen>
  );
}
