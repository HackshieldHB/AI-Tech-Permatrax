'use client';

import { useState } from 'react';
import { fixFileUrl } from '../lib/api';

type ProfileAvatarProps = {
  name: string;
  role: string;
  avatarUrl?: string | null;
  size?: number;
  roleColor?: string;
};

export function ProfileAvatar({ name, avatarUrl, size = 34, roleColor = '#8B949E' }: ProfileAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials =
    name
      ?.split(' ')
      .map((x) => x[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? 'PT';
  const showImage = Boolean(avatarUrl) && !imgFailed;

  if (showImage && avatarUrl) {
    return (
      <img
        src={fixFileUrl(avatarUrl)}
        alt={name}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          border: `1px solid ${roleColor}66`,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `${roleColor}33`,
        border: `1px solid ${roleColor}66`,
        color: roleColor,
        fontSize: Math.max(10, size * 0.35),
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
