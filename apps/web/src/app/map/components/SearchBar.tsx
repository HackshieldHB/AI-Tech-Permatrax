'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { NominatimResult } from '../hooks/types';

export type SearchBarProps = {
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchLoading: boolean;
  searchResults: NominatimResult[];
  setSearchResults: Dispatch<SetStateAction<NominatimResult[]>>;
  showSearchDrop: boolean;
  setShowSearchDrop: Dispatch<SetStateAction<boolean>>;
  handleSearchInput: (q: string) => void;
  handleSearchSelect: (result: NominatimResult) => void;
};

export function SearchBar(props: SearchBarProps) {
  const {
    searchQuery,
    setSearchQuery,
    searchLoading,
    searchResults,
    setSearchResults,
    showSearchDrop,
    setShowSearchDrop,
    handleSearchInput,
    handleSearchSelect,
  } = props;

  return (
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          width: 340,
        }}
      >
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            overflow: 'visible',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowSearchDrop(true)}
              placeholder="Cari lokasi... (misal: GBK, Monas)"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: '#111',
                background: 'transparent',
              }}
            />
            {searchLoading && (
              <div
                style={{
                  width: 14,
                  height: 14,
                  flexShrink: 0,
                  border: '2px solid #00D4B4',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            )}
            {searchQuery && !searchLoading && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowSearchDrop(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 16,
                  color: '#9CA3AF',
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            )}
          </div>

          {showSearchDrop && searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'white',
                borderRadius: '0 0 10px 10px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                maxHeight: 280,
                overflowY: 'auto',
                zIndex: 100,
                marginTop: 2,
              }}
            >
              {searchResults.map((result, i) => (
                <div
                  key={`${result.lat}-${result.lon}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSearchSelect(result)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchSelect(result);
                  }}
                  style={{
                    padding: '10px 14px',
                    borderBottom:
                      i < searchResults.length - 1 ? '1px solid #F3F4F6' : 'none',
                    cursor: 'pointer',
                    transition: 'background 150ms',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'white';
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                    {result.type === 'city'
                      ? '🏙️'
                      : result.type === 'village'
                        ? '🏘️'
                        : result.type === 'suburb'
                          ? '🏘️'
                          : result.type === 'stadium'
                            ? '🏟️'
                            : result.type === 'park'
                              ? '🌳'
                              : result.class === 'highway'
                                ? '🛣️'
                                : result.class === 'building'
                                  ? '🏢'
                                  : '📍'}
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111',
                        lineHeight: 1.4,
                      }}
                    >
                      {result.display_name.split(',')[0]}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#6B7280',
                        marginTop: 1,
                        lineHeight: 1.3,
                      }}
                    >
                      {result.display_name.split(',').slice(1, 3).join(',')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}
