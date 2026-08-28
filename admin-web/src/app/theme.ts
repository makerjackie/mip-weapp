import type { ThemeConfig } from 'antd'

export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1769E0',
    colorInfo: '#1769E0',
    colorSuccess: '#28A474',
    colorWarning: '#D99A25',
    colorError: '#C35645',
    colorBgLayout: '#F3F7FD',
    colorBgContainer: '#FFFFFF',
    colorText: '#26334D',
    colorTextSecondary: '#72809A',
    colorBorderSecondary: '#E4EBF5',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily: 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    boxShadowSecondary: '0 8px 28px rgb(44 76 121 / 10%)',
  },
  components: {
    Button: { controlHeight: 36, fontWeight: 600 },
    Card: { paddingLG: 20 },
    Drawer: { colorBgElevated: '#F3F7FD' },
    Layout: {
      bodyBg: '#F3F7FD',
      headerBg: '#FFFFFF',
      siderBg: '#235BCF',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'rgb(18 62 150 / 22%)',
      darkItemColor: 'rgb(255 255 255 / 82%)',
      darkItemHoverBg: 'rgb(255 255 255 / 12%)',
      darkItemSelectedBg: '#FFFFFF',
      darkItemSelectedColor: '#1769E0',
      itemBorderRadius: 10,
    },
    Table: {
      headerBg: '#F7F9FC',
      headerColor: '#7A879B',
      rowHoverBg: '#F7FAFF',
      borderColor: '#EDF1F6',
    },
  },
}
