<template>
  <div class="header-wrapper">
    <Splite @click="handleSpliteCollapsed"></Splite>
    <!-- <Search></Search> -->
    <LoginState class="avatar" place="pcHeader"></LoginState>
  </div>
  
</template>
<script setup lang="ts">
// import Search from '@/components/layout/header/Search.vue';
import Splite from '@/components/layout/header/Splite.vue'
import LoginState from '@/components/layout/header/LoginState.vue'
const emit = defineEmits(['collapsed'])
const handleSpliteCollapsed = (collapsed:boolean) => {
  console.log('Header handleSpliteClick collapsed', collapsed)
  emit('collapsed', collapsed)
}
</script>
<style scoped lang="less">
.header-wrapper{
  width: 100%;
  height: 60px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 10px;
  .avatar{
    padding-right: 10px;
  }
}

</style>